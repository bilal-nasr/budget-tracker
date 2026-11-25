import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { getProfile } from "@/features/profile/queries";
import { getWallets } from "@/features/wallets/queries";
import { currencyIntent } from "@/lib/currency-intent";
import { defineTool, ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT, balancesOut, requestIdSchema, unwrap } from "@/lib/mcp/write";
import { clearSalary, receiveSalary, saveSalary } from "./actions";
import { getSalaryStatus } from "./queries";
import { salaryInputSchema } from "./schema";

const NO_SALARY = "No salary is saved yet, so give both amountMinor and balanceId.";
const NOT_CONFIGURED = "No salary amount and balance are saved, so salary cannot be marked received. Save them with salary_update first.";

/** Currency-intent header for the salary balance's currency, built the way the salary sheet builds it. */
async function intentForBalance(balanceId: string) {
  const [wallets, currencies] = await Promise.all([
    getWallets({ includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true }),
    getCurrencies(),
  ]);
  const balance = wallets.flatMap((wallet) => wallet.balances).find((item) => item.id === balanceId);
  const definition = balance && currencies.find((currency) => currency.code === balance.currency);
  if (!definition) throw new ToolError(ACTION_ERROR_TEXT.walletUnavailable);
  return currencyIntent(definition);
}

const salary = salaryInputSchema.shape;

export const salaryTools = [
  defineTool({
    name: "salary_status_get",
    title: "Get salary status",
    description:
      "Whether salary has been received: the latest salary entry's date (`lastReceivedOn`) and whether it falls in the current month. " +
      "Use profile_get for the saved salary amount.",
    kind: "read",
    run: async () => getSalaryStatus((await getProfile()).timezone),
  }),
  defineTool({
    name: "salary_update",
    title: "Update salary",
    description:
      "Save the person's fixed salary: the amount and the wallet balance it lands in when salary_mark_received is used. Moves no money. " +
      "`amountMinor` is integer minor units of that balance's currency; balance ids come from wallets_list (balances[].id). " +
      "A field you leave out keeps its saved value (both are needed when no salary is saved yet). " +
      "Send only { clear: true } to remove the saved salary. Returns the profile in the shape profile_get gives (its `salary` field).",
    kind: "write",
    input: z.strictObject({
      amountMinor: salary.amountMinor.optional().describe("Salary amount in integer minor units of the balance's currency (for example cents), at least 1."),
      balanceId: salary.balanceId.optional().describe("Wallet balance id from wallets_list that receives the salary."),
      clear: z.literal(true).optional().describe("true removes the saved salary; send it alone."),
    }).superRefine((value, ctx) => {
      const setting = value.amountMinor !== undefined || value.balanceId !== undefined;
      if (value.clear ? setting : !setting) ctx.addIssue({ code: "custom", message: "Send amountMinor and/or balanceId, or clear: true alone." });
    }),
    run: async ({ amountMinor, balanceId, clear }) => {
      if (clear) {
        unwrap(await clearSalary());
        return getProfile();
      }
      const saved = (await getProfile()).salary;
      const nextAmount = amountMinor ?? saved?.amountMinor;
      const nextBalance = balanceId ?? saved?.balanceId;
      if (nextAmount === undefined || nextBalance === undefined) throw new ToolError(NO_SALARY);
      unwrap(await saveSalary({ expectedUnits: await intentForBalance(nextBalance), amountMinor: nextAmount, balanceId: nextBalance }));
      return getProfile();
    },
  }),
  defineTool({
    name: "salary_mark_received",
    title: "Mark salary received",
    description:
      "Record that this month's salary arrived (the app's \"Got salary\"): the saved salary amount (profile_get `salary`) is added as income to its balance today and a new salary cycle starts for installments. " +
      "The app also emails the wallet summary when that email is on. " +
      "`expectedReceiptId` must be `receiptId` from salary_status_get (null when no salary was ever received): if salary was marked received since, the request is refused instead of adding it twice. " +
      "Returns { status } (salary_status_get shape), { receipt: { id, revision } } and the affected `balances`. " +
      "Send a requestId and reuse it when retrying: the same receipt is returned instead of a second salary.",
    kind: "write",
    input: z.strictObject({
      requestId: requestIdSchema,
      expectedReceiptId: z.uuid().nullable().describe("`receiptId` from salary_status_get, or null when it is null."),
    }),
    run: async ({ requestId, expectedReceiptId }) => {
      // No currency intent: the amount and balance are the saved salary, read inside the RPC, which the
      // database accepts without one; sending none also keeps every retry's intent identical.
      const result = await receiveSalary({ requestId: requestId ?? crypto.randomUUID(), expectedCycleId: expectedReceiptId });
      if (!result.ok && result.error === "invalid") throw new ToolError(NOT_CONFIGURED);
      const receipt = unwrap<{ ok: true; id: string; revision: number }>(result);
      const profile = await getProfile();
      const balanceId = profile.salary?.balanceId;
      return {
        status: await getSalaryStatus(profile.timezone),
        receipt: { id: receipt.id, revision: receipt.revision },
        balances: await balancesOut(balanceId ? [balanceId] : undefined),
      };
    },
  }),
];
