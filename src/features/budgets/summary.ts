import "server-only";
import { getCurrencies } from "@/features/currencies/queries";
import { todayIn } from "@/features/transactions/group";
import { buildCycles, pickCycle, type SpendCycle } from "./cycles";
import { getMonthBudgets, getSalaryReceiptDates } from "./queries";
import type { MonthBudgets } from "./schema";

export type CalendarMonthSummary = { month: string; budgets: MonthBudgets[] };
export type SalaryCycleSummary = { cycle: SpendCycle; budgets: MonthBudgets[] };

/** Full summary: both halves are fetched (`calendarMonth` is never null). */
export type SpendingSummary = { calendarMonth: CalendarMonthSummary; salaryCycle: SalaryCycleSummary | null };
/** `only: "active"`: just the half Home shows. `calendarMonth` is null when a salary cycle exists and was left out. */
export type ActiveSpendingSummary = { calendarMonth: CalendarMonthSummary | null; salaryCycle: SalaryCycleSummary | null };

/**
 * Budgets and spending for the current calendar month and the newest salary cycle, one
 * MonthBudgets per enabled currency in getCurrencies() order, unfiltered. Shared by Home
 * and the connector so both read the same numbers.
 */
export async function getSpendingSummary(timezone: string): Promise<SpendingSummary>;
export async function getSpendingSummary(timezone: string, only: "active"): Promise<ActiveSpendingSummary>;
export async function getSpendingSummary(timezone: string, only?: "active"): Promise<ActiveSpendingSummary> {
  const month = todayIn(timezone).slice(0, 7);
  const [currencies, receiptDates] = await Promise.all([getCurrencies(), getSalaryReceiptDates()]);
  const codes = currencies.filter((currency) => !currency.disabled).map((currency) => currency.code);
  const cycle = pickCycle(buildCycles(receiptDates), null);

  const [calendarBudgets, cycleBudgets] = await Promise.all([
    only === "active" && cycle ? null : Promise.all(codes.map((code) => getMonthBudgets(month, code))),
    cycle ? Promise.all(codes.map((code) => getMonthBudgets(cycle.from.slice(0, 7), code, cycle))) : null,
  ]);

  return {
    calendarMonth: calendarBudgets ? { month, budgets: calendarBudgets } : null,
    salaryCycle: cycle && cycleBudgets ? { cycle, budgets: cycleBudgets } : null,
  };
}
