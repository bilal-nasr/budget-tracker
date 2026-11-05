import { currencyCodeSchema } from "@/features/currencies/schema";
import "server-only";
import { MAX_MINOR, readMinor } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { demoLoans } from "./demo";
import { calculateLoanPaymentPlan } from "./calculations";
import type { Loan, LoanEvent } from "./schema";

const amount = (value: unknown): number => {
  if (typeof value !== "number" && typeof value !== "string") throw new Error("loansUnavailable");
  let n: number;
  try { n = readMinor(value); } catch { throw new Error("loansUnavailable"); }
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
  const items = await allRows((from, to) => supabase.from("loan_overview")
    .select("id,name,direction,currency,balance_id,fee_category_id,opened_on,creation_mode,principal_minor,fee_bps,fee_minor,total_due_minor,principal_paid_before_minor,fee_paid_before_minor,principal_paid_minor,fee_paid_minor,principal_remaining_minor,fee_remaining_minor,remaining_minor,monthly_payment_minor,payment_count,archived_at,deleted_at,live_payment_count,latest_payment_on,latest_payment_id,latest_payment_revision,latest_payment_sequence")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to));
  return items.map((r) => {
    if (!currencyCodeSchema.safeParse(r.currency).success) throw new Error("loansUnavailable");
    const monthlyPaymentMinor = r.monthly_payment_minor == null ? null : amount(r.monthly_payment_minor);
    const paymentCount = r.payment_count == null ? null : amount(r.payment_count);
    const plan = monthlyPaymentMinor !== null && paymentCount !== null ? calculateLoanPaymentPlan(amount(r.total_due_minor), monthlyPaymentMinor, paymentCount) : null;
    if ((monthlyPaymentMinor !== null || paymentCount !== null) && !plan) throw new Error("loansUnavailable");
    const finalPaymentMinor = plan?.finalPaymentMinor ?? null;
    const livePaymentCount = amount(r.live_payment_count);
    if ((livePaymentCount === 0) !== (r.latest_payment_id === null)) throw new Error("loansUnavailable");
    const latestLivePayment = r.latest_payment_id === null ? null : {
      transactionId: r.latest_payment_id, revision: amount(r.latest_payment_revision), sequence: amount(r.latest_payment_sequence),
    };
    return { id: r.id, name: r.name, direction: r.direction, currency: r.currency,
      balanceId: r.balance_id, feeCategoryId: r.fee_category_id, openedOn: r.opened_on, creationMode: r.creation_mode,
      principalMinor: amount(r.principal_minor), feeBps: amount(r.fee_bps), feeMinor: amount(r.fee_minor), totalDueMinor: amount(r.total_due_minor),
      principalPaidBeforeMinor: amount(r.principal_paid_before_minor), feePaidBeforeMinor: amount(r.fee_paid_before_minor),
      principalPaidMinor: amount(r.principal_paid_minor), feePaidMinor: amount(r.fee_paid_minor),
      principalRemainingMinor: amount(r.principal_remaining_minor), feeRemainingMinor: amount(r.fee_remaining_minor), remainingMinor: amount(r.remaining_minor),
      monthlyPaymentMinor, paymentCount, finalPaymentMinor,
      archivedAt: r.archived_at, deletedAt: r.deleted_at, events: [], historyComplete: false, livePaymentCount, latestPaymentOn: r.latest_payment_on, latestLivePayment };
  });
}

export type LoanHistoryPage = { rows: LoanEvent[]; next: number | null };

/** Sequence is unique within a loan, so paging never uses growing offsets. */
export async function getLoanHistory(id: string, before: number | null): Promise<LoanHistoryPage> {
  if (!supabaseConfigured()) {
    const events = (demoLoans().find((loan) => loan.id === id)?.events ?? [])
      .filter((event) => before === null || event.sequence < before).sort((a, b) => b.sequence - a.sequence);
    return { rows: events.slice(0, 30), next: events.length > 30 ? events[29].sequence : null };
  }
  const supabase = await createClient();
  let query = supabase.from("transactions")
    .select("id,revision,loan_id,loan_event,loan_flow,loan_event_seq,balance_id,occurred_on,amount_minor,loan_principal_minor,loan_fee_minor,category_id,deleted_at")
    .eq("loan_id", id).order("loan_event_seq", { ascending: false }).limit(31);
  if (before !== null) query = query.lt("loan_event_seq", before);
  const { data, error } = await query;
  if (error || !data) throw new Error("loansUnavailable");
  const rows: LoanEvent[] = data.slice(0, 30).map((e) => ({
    transactionId: e.id, revision: amount(e.revision), loanId: e.loan_id, event: e.loan_event, flow: e.loan_flow,
    sequence: amount(e.loan_event_seq), balanceId: e.balance_id, occurredOn: e.occurred_on,
    amountMinor: amount(e.amount_minor), principalMinor: amount(e.loan_principal_minor), feeMinor: amount(e.loan_fee_minor),
    categoryId: e.category_id, deletedAt: e.deleted_at,
  }));
  return { rows, next: data.length > 30 ? rows[29].sequence : null };
}
