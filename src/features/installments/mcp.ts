import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { getProfile } from "@/features/profile/queries";
import { getWallets } from "@/features/wallets/queries";
import { currencyIntent } from "@/lib/currency-intent";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool, ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT, once, requestIdSchema, unwrap } from "@/lib/mcp/write";
import { createInstallment, deleteInstallment, updateInstallment } from "./actions";
import { getInstallments } from "./queries";
import { installmentInputSchema } from "./schema";

const NOT_FOUND = "That installment does not exist. Use installments_list to find its id.";
const fields = installmentInputSchema.shape;

const idField = z.uuid().describe("Installment id from installments_list.");
const nameField = fields.name.describe("Name, 1 to 60 characters.");
const totalField = fields.totalMinor.describe("Total owed in integer minor units of the paying balance's currency (for example cents).");
const paidBeforeField = fields.paidBeforeMinor.describe("Already paid before tracking it here, in minor units; 0 to the total. Defaults to 0 on create.");
const balanceField = fields.balanceId.describe("Default paying wallet balance id from wallets_list (balances[].id). Its currency is the installment's currency.");
const categoryField = fields.categoryId.describe("Expense category id from categories_list.");
const monthlyField = fields.monthlyMinor.describe("Planned monthly payment in minor units, or null for an open-ended plan.");
const dueDayField = fields.dueDay.describe("Day of the month it is due (1 to 31), or null for none.");

/** The plan list as installments_list gives it. */
async function listOut() {
  const profile = await getProfile();
  const [installments, currencies] = await Promise.all([getInstallments(profile.timezone), getCurrencies()]);
  const amount = amountFormatter(currencies);
  return {
    installments: installments.map((installment) => {
      const { currency } = installment;
      // The summary query never fills the payment history (`payments` is always empty,
      // `historyComplete` false), so neither is passed on.
      const plan: Partial<typeof installment> = { ...installment };
      delete plan.payments;
      delete plan.historyComplete;
      return {
        ...plan,
        total: amount(installment.totalMinor, currency),
        paidBefore: amount(installment.paidBeforeMinor, currency),
        monthly: installment.monthlyMinor === null ? null : amount(installment.monthlyMinor, currency),
        paid: amount(installment.paidMinor, currency),
        remaining: amount(installment.remainingMinor, currency),
        paidThisCycle: amount(installment.paidThisCycleMinor, currency),
      };
    }),
  };
}

/** Currency-intent header for the paying balance's currency, built the way the UI sheet builds it. */
async function intentForBalance(balanceId: string) {
  const [wallets, currencies] = await Promise.all([
    getWallets({ includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true }),
    getCurrencies(),
  ]);
  const balance = wallets.flatMap((wallet) => wallet.balances).find((b) => b.id === balanceId);
  const definition = balance && currencies.find((c) => c.code === balance.currency);
  if (!definition) throw new ToolError(ACTION_ERROR_TEXT.walletUnavailable);
  return currencyIntent(definition);
}

export const installmentTools = [
  defineTool({
    name: "installments_list",
    title: "List installments",
    description:
      "List installment plans with, per plan: `total`, `paidBefore` (paid before the plan was tracked here), `paid` (paid so far, including `paidBefore`), " +
      "`remaining` (still owed overall; `paid` + `remaining` = `total`), the planned `monthly` amount (null when open-ended) and `dueDay`. " +
      "This salary cycle: `paidThisCycle` (only payments in the current salary cycle), `cyclePaymentCount`, `cycleLatestPaymentId` and `cycleStatus` " +
      "(unpaid, partial, paid or paidOff). Individual payments are not listed; use transactions_list for them. Each plan has one currency.",
    kind: "read",
    run: listOut,
  }),
  defineTool({
    name: "installments_create",
    title: "Create installment",
    description:
      "Add an installment plan paid from one wallet balance. Balance ids come from wallets_list, category ids from categories_list. " +
      "All amounts are integer minor units of that balance's currency; `paidBeforeMinor` cannot exceed `totalMinor`. This only saves the plan; it does not record a payment. " +
      "Returns { installment } in the shape installments_list gives; if the new row cannot be identified with certainty, { installment: null, installments, note } with the fresh list instead. " +
      "Send a requestId and reuse it when retrying so the plan is never created twice.",
    kind: "write",
    input: z
      .strictObject({
        requestId: requestIdSchema,
        name: nameField,
        totalMinor: totalField,
        paidBeforeMinor: paidBeforeField.optional(),
        balanceId: balanceField,
        categoryId: categoryField,
        monthlyMinor: monthlyField.optional(),
        dueDay: dueDayField.optional(),
      })
      .refine((input) => (input.paidBeforeMinor ?? 0) <= input.totalMinor, {
        message: "paidBeforeMinor cannot exceed totalMinor",
        path: ["paidBeforeMinor"],
      }),
    run: ({ requestId, name, totalMinor, paidBeforeMinor, balanceId, categoryId, monthlyMinor, dueDay }) =>
      once("installments_create", requestId, async () => {
        const expectedUnits = await intentForBalance(balanceId);
        const before = new Set((await listOut()).installments.map((i) => i.id));
        unwrap(
          await createInstallment({
            expectedUnits, name, totalMinor, paidBeforeMinor: paidBeforeMinor ?? 0, balanceId, categoryId,
            monthlyMinor: monthlyMinor ?? null, dueDay: dueDay ?? null,
          }),
        );
        const { installments } = await listOut();
        const added = installments.filter((i) => !before.has(i.id));
        if (added.length === 1) return { installment: added[0] as Record<string, unknown> };
        return {
          installment: null,
          installments: installments as Record<string, unknown>[],
          note: "The installment was saved but could not be singled out; it is in this fresh list.",
        };
      }),
  }),
  defineTool({
    name: "installments_update",
    title: "Update installment",
    description:
      "Change an installment plan. Id comes from installments_list; fields you leave out keep their current value (monthlyMinor and dueDay: pass null to clear). " +
      "All amounts are integer minor units of the paying balance's currency. The total cannot go below what was already paid. Returns the updated plan in the shape installments_list gives.",
    kind: "write",
    input: z.strictObject({
      id: idField,
      name: nameField.optional(),
      totalMinor: totalField.optional(),
      paidBeforeMinor: paidBeforeField.optional(),
      balanceId: balanceField.optional(),
      categoryId: categoryField.optional(),
      monthlyMinor: monthlyField.optional(),
      dueDay: dueDayField.optional(),
    }),
    run: async ({ id, name, totalMinor, paidBeforeMinor, balanceId, categoryId, monthlyMinor, dueDay }) => {
      const profile = await getProfile();
      const current = (await getInstallments(profile.timezone)).find((i) => i.id === id);
      if (!current) throw new ToolError(NOT_FOUND);
      const merged = {
        name: name ?? current.name,
        totalMinor: totalMinor ?? current.totalMinor,
        paidBeforeMinor: paidBeforeMinor ?? current.paidBeforeMinor,
        balanceId: balanceId ?? current.balanceId,
        categoryId: categoryId ?? current.categoryId,
        monthlyMinor: monthlyMinor === undefined ? current.monthlyMinor : monthlyMinor,
        dueDay: dueDay === undefined ? current.dueDay : dueDay,
      };
      unwrap(await updateInstallment(id, { expectedUnits: await intentForBalance(merged.balanceId), ...merged }));
      const updated = (await listOut()).installments.find((i) => i.id === id);
      if (!updated) throw new ToolError(NOT_FOUND);
      return { installment: updated as Record<string, unknown> };
    },
  }),
  defineTool({
    name: "installments_delete",
    title: "Delete installment",
    description:
      "Delete an installment plan. Id comes from installments_list. Payments it already recorded stay in the transactions. Returns { deleted: true, id }.",
    kind: "destructive",
    input: z.strictObject({ id: idField }),
    run: async ({ id }) => {
      const profile = await getProfile();
      if (!(await getInstallments(profile.timezone)).some((i) => i.id === id)) throw new ToolError(NOT_FOUND);
      unwrap(await deleteInstallment(id));
      return { deleted: true, id };
    },
  }),
];
