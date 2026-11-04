import "server-only";
import { cache } from "react";
import { getCategories } from "@/features/categories/queries";
import { demoBudgetData } from "@/lib/demo-data";
import { readMinor, type Currency } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { buildMonthBudgets } from "./rows";
import type { BudgetLimit, CategorySpend, MonthBudgets } from "./schema";

/** One month's budgets and spending for one currency. `month` is YYYY-MM. */
export async function getMonthBudgets(month: string, currency: Currency): Promise<MonthBudgets> {
  const categories = await getCategories();
  if (!supabaseConfigured()) {
    const demo = demoBudgetData(month);
    return buildMonthBudgets(month, currency, categories, demo.budgets, demo.spend);
  }

  const { limits, spent } = await getMonthRows(month);
  return buildMonthBudgets(month, currency, categories, limits, spent);
}

// React cache coalesces the all-currency RPC reads within one server request.
const getMonthRows = cache(async (month: string) => {
  const supabase = await createClient();
  const first = `${month}-01`;
  const [budgets, spend] = await Promise.all([
    supabase.rpc("month_budgets", { p_month: first }),
    supabase.rpc("month_category_spend", { p_month: first }),
  ]);
  // Before the budgets migration is applied the functions do not exist.
  if (budgets.error) console.error("[getMonthBudgets budgets]", budgets.error.message);
  if (spend.error) console.error("[getMonthBudgets spend]", spend.error.message);
  if (budgets.error || spend.error) throw new Error("Budget data unavailable");

  const limits: BudgetLimit[] = (budgets.data ?? []).map(
    (b: { category_id: string; currency: Currency; limit_minor: number | string }) => ({
      categoryId: b.category_id,
      currency: b.currency,
      limitMinor: readMinor(b.limit_minor),
    }),
  );
  const spent: CategorySpend[] = (spend.data ?? []).map(
    (s: { category_id: string; currency: Currency; spent_minor: number | string }) => ({
      categoryId: s.category_id,
      currency: s.currency,
      spentMinor: readMinor(s.spent_minor),
    }),
  );
  return { limits, spent };
});
