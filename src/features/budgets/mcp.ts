import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { currencyCodeSchema } from "@/features/currencies/schema";
import { todayIn } from "@/features/transactions/group";
import { getProfile } from "@/features/profile/queries";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool } from "@/lib/mcp/tool";
import { getMonthBudgets } from "./queries";
import type { MonthBudgets } from "./schema";
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
];
