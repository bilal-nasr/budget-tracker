import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { currencyCodeSchema } from "@/features/currencies/schema";
import { todayIn } from "@/features/transactions/group";
import { getProfile } from "@/features/profile/queries";
import { currencyIntent } from "@/lib/currency-intent";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool, ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT, unwrap } from "@/lib/mcp/write";
import { saveBudgets } from "./actions";
import { getMonthBudgets } from "./queries";
import { budgetEditSchema, type MonthBudgets } from "./schema";
import { getSpendingSummary } from "./summary";

type Amount = ReturnType<typeof amountFormatter>;

/** One currency's budgets with the display form of every amount beside the raw one. */
function withAmounts(budgets: MonthBudgets, amount: Amount) {
  const { currency } = budgets;
  return {
    ...budgets,
    rows: budgets.rows.map((row) => ({
      ...row,
      limit: row.limitMinor === null ? null : amount(row.limitMinor, currency),
      spent: amount(row.spentMinor, currency),
      left: row.leftMinor === null ? null : amount(row.leftMinor, currency),
    })),
    totalLimit: amount(budgets.totalLimitMinor, currency),
    totalSpent: amount(budgets.totalSpentMinor, currency),
  };
}

const monthField = budgetEditSchema.shape.month.describe("Month the limit starts in, YYYY-MM. Later months inherit it until changed again; earlier months keep their old limit.");
const currencyField = currencyCodeSchema.describe("Currency code from currencies_list. Limits in different currencies are separate.");
const limitItem = budgetEditSchema.shape.limits.element;
const limitMinorField = limitItem.shape.limitMinor.unwrap().describe("The limit in integer minor units of `currency` (for example cents), at least 1.");
const categoryIdField = limitItem.shape.categoryId.describe("Category id from categories_list (an active expense category).");

/** The month's budgets as budgets_get gives them, re-read after a change. */
async function budgetsOut(month: string, currency: string) {
  const currencies = await getCurrencies();
  return withAmounts(await getMonthBudgets(month, currency), amountFormatter(currencies));
}

/** Currency-intent header for the one currency a limit is in, built from the person's own list. */
async function intentFor(currency: string) {
  const definition = (await getCurrencies()).find((c) => c.code === currency);
  if (!definition) throw new ToolError(ACTION_ERROR_TEXT.currencyUnavailable);
  return currencyIntent(definition);
}

export const budgetTools = [
  defineTool({
    name: "summary_get",
    title: "Get spending summary",
    description:
      "Budgets and spending for the current calendar month and for the latest salary cycle (null when there is no salary yet), " +
      "one entry per currency; currencies are never combined. Use it first for 'how am I doing' questions, then budgets_get or transactions_list for detail.",
    kind: "read",
    run: async () => {
      const [{ timezone }, currencies] = await Promise.all([getProfile(), getCurrencies()]);
      const summary = await getSpendingSummary(timezone);
      const amount = amountFormatter(currencies);
      return {
        calendarMonth: {
          month: summary.calendarMonth.month,
          budgets: summary.calendarMonth.budgets.map((budgets) => withAmounts(budgets, amount)),
        },
        salaryCycle: summary.salaryCycle && {
          cycle: summary.salaryCycle.cycle,
          budgets: summary.salaryCycle.budgets.map((budgets) => withAmounts(budgets, amount)),
        },
      };
    },
  }),
  defineTool({
    name: "budgets_get",
    title: "Get budgets",
    description:
      "Per-category limits, spending and what is left for one month in one currency. `month` is YYYY-MM and defaults to the current month; " +
      "`currency` is a code from currencies_list. Use categories_list to name the category ids in the rows.",
    kind: "read",
    input: z.object({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
      currency: currencyCodeSchema,
    }),
    run: async ({ month, currency }) => {
      const [profile, currencies] = await Promise.all([getProfile(), getCurrencies()]);
      const budgets = await getMonthBudgets(month ?? todayIn(profile.timezone).slice(0, 7), currency);
      return withAmounts(budgets, amountFormatter(currencies));
    },
  }),
  defineTool({
    name: "budgets_set",
    title: "Set budget limits",
    description:
      "Create or change the spending limit of one or more categories in one currency, starting from `month` (YYYY-MM): earlier months keep their old limit, later months inherit this one until it is changed again. " +
      "Category ids come from categories_list, currency codes from currencies_list. Limits are integer minor units of that one currency (for example cents for USD). " +
      "Returns the month's budgets in the shape budgets_get gives, with the new limits in the rows.",
    kind: "write",
    input: z
      .strictObject({
        month: monthField,
        currency: currencyField,
        limits: z
          .array(z.strictObject({ categoryId: categoryIdField, limitMinor: limitMinorField }))
          .min(1)
          .max(200)
          .describe("One entry per category whose limit changes."),
      })
      .refine((input) => new Set(input.limits.map((l) => l.categoryId)).size === input.limits.length, {
        message: "Each category may appear once",
        path: ["limits"],
      }),
    run: async ({ month, currency, limits }) => {
      unwrap(await saveBudgets({ expectedUnits: await intentFor(currency), month, currency, limits }));
      return budgetsOut(month, currency);
    },
  }),
  defineTool({
    name: "budgets_delete",
    title: "Remove a budget limit",
    description:
      "Remove one category's spending limit in one currency from `month` (YYYY-MM) on: earlier months keep their limit, this and later months have none. " +
      "Category ids come from categories_list. Returns { deleted: true, id (the category id), budgets } where budgets is the month in the shape budgets_get gives.",
    kind: "destructive",
    input: z.strictObject({
      month: monthField.describe("First month with no limit, YYYY-MM."),
      currency: currencyField,
      categoryId: categoryIdField.describe("Category id from categories_list whose limit is removed."),
    }),
    run: async ({ month, currency, categoryId }) => {
      unwrap(await saveBudgets({ expectedUnits: await intentFor(currency), month, currency, limits: [{ categoryId, limitMinor: null }] }));
      return { deleted: true, id: categoryId, budgets: await budgetsOut(month, currency) };
    },
  }),
];
