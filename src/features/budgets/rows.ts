import type { Category } from "@/features/categories/schema";
import type { Currency } from "@/lib/money";
import type { BudgetLimit, BudgetRow, CategorySpend, MonthBudgets } from "./schema";

/**
 * Builds one month's budget rows for one currency. Pure, so the live query and
 * the demo data share it. Other currencies are ignored, never converted.
 */
export function buildMonthBudgets(
  month: string,
  currency: Currency,
  categories: readonly Category[],
  budgets: readonly BudgetLimit[],
  spend: readonly CategorySpend[],
): MonthBudgets {
  const limits = new Map(budgets.filter((b) => b.currency === currency).map((b) => [b.categoryId, b.limitMinor]));
  const spent = new Map(spend.filter((s) => s.currency === currency).map((s) => [s.categoryId, s.spentMinor]));

  const budgeted: BudgetRow[] = [];
  const unbudgeted: BudgetRow[] = [];
  for (const category of [...categories].filter((c) => c.kind === "expense").sort((a, b) => a.position - b.position)) {
    const limit = limits.get(category.id) ?? null;
    const spentMinor = spent.get(category.id) ?? 0;
    if (limit !== null) {
      budgeted.push({
        categoryId: category.id,
        limitMinor: limit,
        spentMinor,
        leftMinor: limit - spentMinor,
        progress: spentMinor / limit,
      });
    } else if (spentMinor > 0) {
      unbudgeted.push({ categoryId: category.id, limitMinor: null, spentMinor, leftMinor: null, progress: 0 });
    }
  }

  return {
    month,
    currency,
    rows: [...budgeted, ...unbudgeted],
    totalLimitMinor: budgeted.reduce((sum, r) => sum + (r.limitMinor ?? 0), 0),
    totalSpentMinor: [...spent.values()].reduce((sum, v) => sum + v, 0),
  };
}

export const isOver = (row: BudgetRow) => row.leftMinor !== null && row.leftMinor < 0;
