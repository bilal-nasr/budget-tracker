import { readMinor } from "@/lib/money";
import "server-only";
import { demoFixed } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { todayIn } from "@/features/transactions/group";
import type { FixedExpense } from "./schema";

/**
 * Fixed expenses with whether each was recorded as paid in the current pay
 * cycle. A cycle starts when the latest salary receipt was recorded (the same
 * recording-order rule installments use), so a payment made after the 28th is
 * still "paid" in the next calendar month and only resets on the next salary.
 * With no salary recorded yet it falls back to the calendar month.
 */
export async function getFixedExpenses(timezone: string): Promise<FixedExpense[]> {
  if (!supabaseConfigured()) return demoFixed();

  const supabase = await createClient();
  const { data: receipt } = await supabase
    .from("transactions")
    .select("created_at")
    .eq("source", "salary")
    .eq("kind", "income")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  let paidQuery = supabase
    .from("transactions")
    .select("fixed_expense_id, occurred_on")
    .eq("source", "fixed")
    .is("deleted_at", null)
    .order("occurred_on", { ascending: false });
  paidQuery = receipt
    ? paidQuery.gte("created_at", receipt.created_at)
    : paidQuery.gte("occurred_on", `${todayIn(timezone).slice(0, 7)}-01`);
  const [items, paid] = await Promise.all([
    supabase
      .from("fixed_expenses")
      .select("id, name, amount_minor, balance_id, category_id, due_day, items")
      .order("position")
      .order("created_at"),
    paidQuery,
  ]);
  if (items.error || !items.data) {
    // Before the fixed-expenses migration is applied the table does not exist.
    if (items.error) console.error("[getFixedExpenses]", items.error.message);
    return [];
  }
  const paidOn = new Map<string, string>();
  for (const row of paid.data ?? []) {
    if (row.fixed_expense_id && !paidOn.has(row.fixed_expense_id)) paidOn.set(row.fixed_expense_id, row.occurred_on);
  }
  return items.data.map((f) => ({
    id: f.id,
    name: f.name,
    amountMinor: readMinor(f.amount_minor),
    balanceId: f.balance_id,
    categoryId: f.category_id,
    dueDay: f.due_day,
    paidOn: paidOn.get(f.id) ?? null,
    items: f.items ?? [],
  }));
}
