import "server-only";
import { demoFixed } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { todayIn } from "@/features/transactions/group";
import type { FixedExpense } from "./schema";

/** Fixed expenses with whether each was recorded as paid in the current month. */
export async function getFixedExpenses(timezone: string): Promise<FixedExpense[]> {
  if (!supabaseConfigured()) return demoFixed();

  const supabase = await createClient();
  const monthStart = `${todayIn(timezone).slice(0, 7)}-01`;
  const [items, paid] = await Promise.all([
    supabase
      .from("fixed_expenses")
      .select("id, name, amount_minor, wallet_id, category_id, due_day")
      .order("position")
      .order("created_at"),
    supabase
      .from("transactions")
      .select("fixed_expense_id, occurred_on")
      .eq("source", "fixed")
      .is("deleted_at", null)
      .gte("occurred_on", monthStart)
      .order("occurred_on", { ascending: false }),
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
    amountMinor: Number(f.amount_minor),
    walletId: f.wallet_id,
    categoryId: f.category_id,
    dueDay: f.due_day,
    paidOn: paidOn.get(f.id) ?? null,
  }));
}
