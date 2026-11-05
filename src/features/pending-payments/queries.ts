import { currencyCodeSchema } from "@/features/currencies/schema";
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { readMinor } from "@/lib/money";
import type { PendingPayment, PendingReceipt } from "./schema";

type JobRow = { id: string; client: string; project: string; currency: string; total_minor: number | string; received_minor: number | string;
  remaining_minor: number | string; due_on: string | null; revision: number; has_receipt_history: boolean };
type ReceiptRow = { id: string; pending_payment_id: string; amount_minor: number | string; occurred_on: string; balance_id: string };
const PAGE_SIZE = 500;
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await page(from, from + PAGE_SIZE - 1);
    if (result.error || !result.data) throw new Error("Pending payments unavailable");
    rows.push(...result.data);
    if (result.data.length < PAGE_SIZE) return rows;
  }
}

const DEMO_PAYMENT_ID = "ab000000-0000-4000-8000-000000000001";

/** Job summaries only. Receipt history loads per job on demand (getPendingReceipts). */
export async function getPendingPayments(): Promise<PendingPayment[]> {
  if (!supabaseConfigured()) return [{
    id: DEMO_PAYMENT_ID, client: "Demo client", project: "Website design", currency: "USD",
    totalMinor: 60000, receivedMinor: 20000, remainingMinor: 40000, dueOn: null, revision: 1, hasReceiptHistory: true,
  }];
  const db = await createClient();
  const jobs = await readAll<JobRow>((from, to) => db.from("pending_payment_progress").select("id,client,project,currency,total_minor,received_minor,remaining_minor,due_on,revision,has_receipt_history").is("deleted_at", null).order("created_at", { ascending: false }).order("id").range(from, to));
  return jobs.map((job) => {
    if (!currencyCodeSchema.safeParse(job.currency).success) throw new Error("Invalid pending payment currency");
    return {
      id: job.id, client: job.client, project: job.project, currency: job.currency, totalMinor: readMinor(job.total_minor),
      receivedMinor: readMinor(job.received_minor), remainingMinor: readMinor(job.remaining_minor), dueOn: job.due_on, revision: job.revision,
      hasReceiptHistory: job.has_receipt_history,
    };
  });
}

/** Live receipts of one job, newest first. RLS limits rows to the signed-in owner. */
export async function getPendingReceipts(paymentId: string): Promise<PendingReceipt[]> {
  if (!supabaseConfigured()) return paymentId === DEMO_PAYMENT_ID
    ? [{ id: "ab000000-0000-4000-8000-000000000002", amountMinor: 20000, occurredOn: "2026-11-01", balanceId: "00000000-0000-4000-8000-000000000001" }]
    : [];
  const db = await createClient();
  const receipts = await readAll<ReceiptRow>((from, to) => db.from("transactions").select("id,pending_payment_id,amount_minor,occurred_on,balance_id").eq("pending_payment_id", paymentId).is("deleted_at", null).order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).order("id").range(from, to));
  return receipts.map((receipt) => ({ id: receipt.id, amountMinor: readMinor(receipt.amount_minor), occurredOn: receipt.occurred_on, balanceId: receipt.balance_id }));
}
