import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { getProfile } from "@/features/profile/queries";
import { getWallets } from "@/features/wallets/queries";
import { currencyIntent } from "@/lib/currency-intent";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool, ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT, once, requestIdSchema, unwrap } from "@/lib/mcp/write";
import { createFixedExpense, deleteFixedExpense, updateFixedExpense } from "./actions";
import { getFixedExpenses } from "./queries";
import { fixedInputSchema, type FixedExpense } from "./schema";

const NOT_FOUND = "That fixed expense does not exist. Use fixed_expenses_list to find its id.";
const fields = fixedInputSchema.shape;

const idField = z.uuid().describe("Fixed expense id from fixed_expenses_list.");
const nameField = fields.name.describe("Name, 1 to 60 characters.");
const amountField = fields.amountMinor.describe("Amount in integer minor units of the paying balance's currency (for example cents).");
const balanceField = fields.balanceId.describe("Paying wallet balance id from wallets_list (balances[].id). Its currency is the expense's currency.");
const categoryField = fields.categoryId.describe("Expense category id from categories_list.");
const dueDayField = fields.dueDay.describe("Day of the month it is due (1 to 31), or null for none.");
const itemsField = fields.items.describe("Optional descriptive breakdown of the amount (description, amountMinor). It must not add up to more than the amount and does not move money.");

/** The expense list as fixed_expenses_list gives it. */
async function listOut() {
  const profile = await getProfile();
  const [expenses, wallets, currencies] = await Promise.all([
    getFixedExpenses(profile.timezone),
    getWallets({ includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true }),
    getCurrencies(),
  ]);
  const amount = amountFormatter(currencies);
  const currencyOf = new Map(wallets.flatMap((wallet) => wallet.balances.map((balance) => [balance.id, balance.currency] as const)));
  return {
    expenses: expenses.map((expense) => {
      const currency = currencyOf.get(expense.balanceId);
      // Without the paying balance's currency an amount stays raw rather than risk a wrong figure.
      if (!currency) return expense;
      return {
        ...expense,
        currency,
        amount: amount(expense.amountMinor, currency),
        ...(expense.items ? { items: expense.items.map((item) => ({ ...item, amount: amount(item.amountMinor, currency) })) } : {}),
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

type Out = Awaited<ReturnType<typeof listOut>>["expenses"][number];
const withId = (expense: Out, id: string) => expense.id === id;

export const fixedTools = [
  defineTool({
    name: "fixed_expenses_list",
    title: "List fixed expenses",
    description:
      "List the recurring fixed expenses (rent, subscriptions and the like): amount, due day, and `paidOn`: the date of its newest payment recorded since the latest salary receipt was recorded " +
      "(with no salary recorded yet, paid on or after the 1st of the current calendar month), or null if it has not been paid in that period. " +
      "Each amount is in the currency of its paying balance; use wallets_list to see the balances and categories_list for category ids.",
    kind: "read",
    run: listOut,
  }),
  defineTool({
    name: "fixed_expenses_create",
    title: "Create fixed expense",
    description:
      "Add a recurring fixed expense (rent, a subscription and the like) paid from one wallet balance. Balance ids come from wallets_list, category ids from categories_list. " +
      "`amountMinor` is in integer minor units of that balance's currency. This only saves the template; it does not record a payment. " +
      "Returns { expense } in the shape fixed_expenses_list gives; if the new row cannot be identified with certainty, { expense: null, expenses, note } with the fresh list instead. " +
      "Send a requestId and reuse it when retrying so the expense is never created twice.",
    kind: "write",
    input: z.strictObject({
      requestId: requestIdSchema,
      name: nameField,
      amountMinor: amountField,
      balanceId: balanceField,
      categoryId: categoryField,
      dueDay: dueDayField.optional(),
      items: itemsField.optional(),
    }),
    run: ({ requestId, name, amountMinor, balanceId, categoryId, dueDay, items }) =>
      once("fixed_expenses_create", requestId, async () => {
        const expectedUnits = await intentForBalance(balanceId);
        const before = new Set((await listOut()).expenses.map((e) => e.id));
        unwrap(await createFixedExpense({ expectedUnits, name, amountMinor, balanceId, categoryId, dueDay: dueDay ?? null, items: items ?? [] }));
        const { expenses } = await listOut();
        const added = expenses.filter((e) => !before.has(e.id));
        if (added.length === 1) return { expense: added[0] as Record<string, unknown> };
        return {
          expense: null,
          expenses: expenses as Record<string, unknown>[],
          note: "The expense was saved but could not be singled out; it is in this fresh list.",
        };
      }),
  }),
  defineTool({
    name: "fixed_expenses_update",
    title: "Update fixed expense",
    description:
      "Change a fixed expense. Id comes from fixed_expenses_list; fields you leave out keep their current value (dueDay: pass null to clear it). " +
      "`amountMinor` is in integer minor units of the paying balance's currency. Returns the updated expense in the shape fixed_expenses_list gives.",
    kind: "write",
    input: z.strictObject({
      id: idField,
      name: nameField.optional(),
      amountMinor: amountField.optional(),
      balanceId: balanceField.optional(),
      categoryId: categoryField.optional(),
      dueDay: dueDayField.optional(),
      items: itemsField.optional(),
    }),
    run: async ({ id, name, amountMinor, balanceId, categoryId, dueDay, items }) => {
      const profile = await getProfile();
      const current = (await getFixedExpenses(profile.timezone)).find((e: FixedExpense) => e.id === id);
      if (!current) throw new ToolError(NOT_FOUND);
      const merged = {
        name: name ?? current.name,
        amountMinor: amountMinor ?? current.amountMinor,
        balanceId: balanceId ?? current.balanceId,
        categoryId: categoryId ?? current.categoryId,
        dueDay: dueDay === undefined ? current.dueDay : dueDay,
        items: items ?? current.items ?? [],
      };
      unwrap(await updateFixedExpense(id, { expectedUnits: await intentForBalance(merged.balanceId), ...merged }));
      const updated = (await listOut()).expenses.find((e) => withId(e, id));
      if (!updated) throw new ToolError(NOT_FOUND);
      return { expense: updated as Record<string, unknown> };
    },
  }),
  defineTool({
    name: "fixed_expenses_delete",
    title: "Delete fixed expense",
    description:
      "Delete a fixed expense template. Id comes from fixed_expenses_list. Payments it already recorded stay in the transactions. Returns { deleted: true, id }.",
    kind: "destructive",
    input: z.strictObject({ id: idField }),
    run: async ({ id }) => {
      const profile = await getProfile();
      if (!(await getFixedExpenses(profile.timezone)).some((e) => e.id === id)) throw new ToolError(NOT_FOUND);
      unwrap(await deleteFixedExpense(id));
      return { deleted: true, id };
    },
  }),
];
