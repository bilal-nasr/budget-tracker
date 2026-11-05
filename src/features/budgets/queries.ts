import "server-only";
import { cache } from "react";
import { getCategories } from "@/features/categories/queries";
import { demoBudgetData } from "@/lib/demo-data";
import { readMinor } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { buildMonthBudgets } from "./rows";
import type { SpendCycle } from "./cycles";
import type { BudgetLimit, CategorySpend, MonthBudgets } from "./schema";

/** One month's budgets and spending for one currency. `month` is YYYY-MM. */
export async function getMonthBudgets(month: string, currency: string, cycle?: SpendCycle): Promise<MonthBudgets> {
  const categories = await getCategories();
  if (!supabaseConfigured()) {
    const demo = demoBudgetData(month);
    return buildMonthBudgets(month, currency, categories, demo.budgets, demo.spend, cycle);
  }

  const { limits, spent } = await getMonthRows(month, cycle?.from ?? null, cycle?.to ?? null);
  return buildMonthBudgets(month, currency, categories, limits, spent, cycle);
}

/** Dates (YYYY-MM-DD) of recorded salary receipts, newest first. Empty means: count by calendar month. */
export const getSalaryReceiptDates = cache(async (): Promise<string[]> => {
  if (!supabaseConfigured()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("transactions").select("occurred_on")
    .eq("source", "salary").eq("kind", "income").is("deleted_at", null)
    .order("occurred_on", { ascending: false }).limit(240);
  if (error) { console.error("[getSalaryReceiptDates]", error.message); return []; }
  return (data ?? []).map((row) => row.occurred_on);
});

// React cache coalesces the all-currency RPC reads within one server request.
const getMonthRows = cache(async (month: string, cycleFrom: string | null, cycleTo: string | null) => {
  const supabase = await createClient();
  const first = `${month}-01`;
  const [budgets, spend] = await Promise.all([
    supabase.rpc("month_budgets", { p_month: first }),
    cycleFrom ? supabase.rpc("category_spend_between", { p_from: cycleFrom, p_to: cycleTo }) : supabase.rpc("month_category_spend", { p_month: first }),
  ]);
  // Before the budgets migration is applied the functions do not exist.
  if (budgets.error) console.error("[getMonthBudgets budgets]", budgets.error.message);
  if (spend.error) console.error("[getMonthBudgets spend]", spend.error.message);
  if (budgets.error || spend.error) throw new Error("Budget data unavailable");

  const limits: BudgetLimit[] = (budgets.data ?? []).map(
    (b: { category_id: string; currency: string; limit_minor: number | string }) => ({
      categoryId: b.category_id,
      currency: b.currency,
      limitMinor: readMinor(b.limit_minor),
    }),
  );
  const spent: CategorySpend[] = (spend.data ?? []).map(
    (s: { category_id: string; currency: string; spent_minor: number | string }) => ({
      categoryId: s.category_id,
      currency: s.currency,
      spentMinor: readMinor(s.spent_minor),
    }),
  );
  return { limits, spent };
});
