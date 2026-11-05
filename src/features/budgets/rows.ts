import type { Category } from "@/features/categories/schema";
import { sumMinor } from "@/lib/money";
import type { BudgetLimit, BudgetRow, CategorySpend, MonthBudgets } from "./schema";

/**
 * Builds one month's budget rows for one currency. Pure, so the live query and
 * the demo data share it. Other currencies are ignored, never converted.
 */
export function buildMonthBudgets(
  month: string,
  currency: string,
  categories: readonly Category[],
  budgets: readonly BudgetLimit[],
  spend: readonly CategorySpend[],
  cycle?: { from: string; to: string | null },
): MonthBudgets {
  const limits = new Map(budgets.filter((b) => b.currency === currency).map((b) => [b.categoryId, b.limitMinor]));
  const spent = new Map(spend.filter((s) => s.currency === currency).map((s) => [s.categoryId, s.spentMinor]));

  const budgeted: BudgetRow[] = [];
  const unbudgeted: BudgetRow[] = [];
  for (const category of [...categories].filter((c) => c.kind === "expense" && c.parentId === null).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
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
    ...(cycle ? { cycle } : {}),
    currency,
    rows: [...budgeted, ...unbudgeted],
    totalLimitMinor: sumMinor(budgeted.map((row) => row.limitMinor ?? 0)),
    totalSpentMinor: sumMinor([...spent.values()]),
  };
}

export const isOver = (row: BudgetRow) => row.leftMinor !== null && row.leftMinor < 0;

/** Historical spending/budgets remain visible when the last wallet is archived. */
export function availableBudgetCurrencies(
  catalog: readonly { code: string; disabled: boolean }[],
  months: readonly MonthBudgets[],
): string[] {
  return catalog.filter((currency) => !currency.disabled || months.some((month) => month.currency === currency.code && month.rows.length > 0)).map((currency) => currency.code);
}
