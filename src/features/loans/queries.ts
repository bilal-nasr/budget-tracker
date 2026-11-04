import "server-only";
import { isCurrency, MAX_MINOR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { demoLoans } from "./demo";
import { calculateLoanPaymentPlan } from "./calculations";
import type { Loan, LoanEvent } from "./schema";

const amount = (value: unknown): number => {
  if (typeof value !== "number" && typeof value !== "string") throw new Error("loansUnavailable");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_MINOR) throw new Error("loansUnavailable");
  return n;
};

const PAGE_SIZE = 500;
/** Stay below PostgREST's default 1000-row cap; stable unique order is supplied by each reader. */
async function allRows<T extends { id: string }>(load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = []; const seen = new Set<string>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await load(offset, offset + PAGE_SIZE - 1);
    if (page.error || !Array.isArray(page.data)) throw new Error("loansUnavailable");
    for (const row of page.data) {
      // Concurrent inserts shifting an offset must fail closed, never double count.
      if (typeof row.id !== "string" || seen.has(row.id)) throw new Error("loansUnavailable");
      seen.add(row.id); rows.push(row);
    }
    if (page.data.length < PAGE_SIZE) return rows;
  }
}

/** Batched, tenant-filtered by RLS; errors never masquerade as an empty loan list. */
export async function getLoans(): Promise<Loan[]> {
  if (!supabaseConfigured()) return demoLoans();
  const supabase = await createClient();
  const [items, events] = await Promise.all([
    allRows((from, to) => supabase.from("loan_progress").select("*").order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to)),
    allRows((from, to) => supabase.from("transactions").select("id,revision,loan_id,loan_event,loan_flow,loan_event_seq,wallet_id,occurred_on,amount_minor,loan_principal_minor,loan_fee_minor,category_id,deleted_at")
      .eq("kind", "loan").order("loan_id").order("loan_event_seq", { ascending: false }).order("id", { ascending: false }).range(from, to)),
  ]);
  const histories = new Map<string, LoanEvent[]>();
  for (const e of events) {
    const event: LoanEvent = { transactionId: e.id, revision: amount(e.revision), loanId: e.loan_id, event: e.loan_event, flow: e.loan_flow,
      sequence: amount(e.loan_event_seq), walletId: e.wallet_id, occurredOn: e.occurred_on,
      amountMinor: amount(e.amount_minor), principalMinor: amount(e.loan_principal_minor), feeMinor: amount(e.loan_fee_minor),
      categoryId: e.category_id, deletedAt: e.deleted_at };
    const history = histories.get(event.loanId) ?? [];
    history.push(event); histories.set(event.loanId, history);
  }
  return items.map((r) => {
    if (!isCurrency(r.currency)) throw new Error("loansUnavailable");
    const monthlyPaymentMinor = r.monthly_payment_minor == null ? null : amount(r.monthly_payment_minor);
    const paymentCount = r.payment_count == null ? null : amount(r.payment_count);
    const plan = monthlyPaymentMinor !== null && paymentCount !== null ? calculateLoanPaymentPlan(amount(r.total_due_minor), monthlyPaymentMinor, paymentCount) : null;
    if ((monthlyPaymentMinor !== null || paymentCount !== null) && !plan) throw new Error("loansUnavailable");
    const finalPaymentMinor = plan?.finalPaymentMinor ?? null;
    return { id: r.id, name: r.name, direction: r.direction, currency: r.currency,
      walletId: r.wallet_id, feeCategoryId: r.fee_category_id, openedOn: r.opened_on, creationMode: r.creation_mode,
      principalMinor: amount(r.principal_minor), feeBps: amount(r.fee_bps), feeMinor: amount(r.fee_minor), totalDueMinor: amount(r.total_due_minor),
      principalPaidBeforeMinor: amount(r.principal_paid_before_minor), feePaidBeforeMinor: amount(r.fee_paid_before_minor),
      principalPaidMinor: amount(r.principal_paid_minor), feePaidMinor: amount(r.fee_paid_minor),
      principalRemainingMinor: amount(r.principal_remaining_minor), feeRemainingMinor: amount(r.fee_remaining_minor), remainingMinor: amount(r.remaining_minor),
      monthlyPaymentMinor, paymentCount, finalPaymentMinor,
      archivedAt: r.archived_at, deletedAt: r.deleted_at, events: histories.get(r.id) ?? [] };
  });
}
