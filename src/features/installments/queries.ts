import "server-only";
import { demoInstallments } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { todayIn } from "@/features/transactions/group";
import { withProgress, type Installment, type InstallmentPayment } from "./schema";

/** Installments with their payment history (newest first) and what is left. */
export async function getInstallments(timezone: string): Promise<Installment[]> {
  if (!supabaseConfigured()) return demoInstallments();

  const supabase = await createClient();
  const monthStart = `${todayIn(timezone).slice(0, 7)}-01`;
  const [items, payments] = await Promise.all([
    supabase
      .from("installments")
      .select("id, name, total_minor, paid_before_minor, currency, wallet_id, category_id, monthly_minor, due_day")
      .order("position")
      .order("created_at"),
    supabase
      .from("transactions")
      .select("id, installment_id, amount_minor, occurred_on, wallet_id")
      .not("installment_id", "is", null)
      .is("deleted_at", null)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  if (items.error || !items.data) {
    // Before the installments migration is applied the table does not exist.
    if (items.error) console.error("[getInstallments]", items.error.message);
    return [];
  }
  const byInstallment = new Map<string, InstallmentPayment[]>();
  for (const p of payments.data ?? []) {
    if (!p.installment_id) continue;
    const list = byInstallment.get(p.installment_id) ?? [];
    list.push({
      transactionId: p.id,
      amountMinor: Number(p.amount_minor),
      occurredOn: p.occurred_on,
      walletId: p.wallet_id,
    });
    byInstallment.set(p.installment_id, list);
  }
  return items.data.map((i) =>
    withProgress(
      {
        id: i.id,
        name: i.name,
        currency: i.currency,
        walletId: i.wallet_id,
        categoryId: i.category_id,
        totalMinor: Number(i.total_minor),
        paidBeforeMinor: Number(i.paid_before_minor),
        monthlyMinor: i.monthly_minor === null ? null : Number(i.monthly_minor),
        dueDay: i.due_day,
      },
      byInstallment.get(i.id) ?? [],
      monthStart,
    ),
  );
}
