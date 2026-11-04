import "server-only";

import { cache } from "react";
import { z } from "zod";
import { CURRENCIES, readMinor } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { demoInstallments, demoSalaryReceipt } from "@/lib/demo-data";
import { toTransaction } from "@/features/transactions/queries";
import { withProgress, type Installment, type InstallmentPayment, type SalaryReceipt } from "./cycle";

export type InstallmentCycleSnapshot = { receipt: SalaryReceipt | null; installments: Installment[] };

const minor = z.union([z.string().regex(/^-?\d+$/), z.number().int()]).transform((value) => readMinor(value));
const positiveMinor = minor.pipe(z.number().int().min(1));
const nonnegativeMinor = minor.pipe(z.number().int().min(0));
const recordedTime = z.iso.datetime({ offset: true });
const installmentRow = z.object({
  id: z.uuid(), name: z.string().min(1).max(60), currency: z.enum(CURRENCIES),
  wallet_id: z.uuid(), category_id: z.uuid(), total_minor: positiveMinor, paid_before_minor: nonnegativeMinor,
  monthly_minor: positiveMinor.nullable(), due_day: z.number().int().min(1).max(31).nullable(),
});
const paymentRow = z.object({
  id: z.uuid(), installment_id: z.uuid(), wallet_id: z.uuid(), amount_minor: positiveMinor,
  occurred_on: z.iso.date(), created_at: recordedTime, salary_cycle_id: z.uuid().nullable(),
  revision: z.number().int().min(1).max(2_147_483_647),
  kind: z.literal("expense"), currency: z.enum(CURRENCIES), category_id: z.uuid(), note: z.string().max(140).nullable(),
  to_wallet_id: z.null(), to_amount_minor: z.null(), source: z.literal("installment"), fixed_expense_id: z.uuid().nullable(),
  loan_id: z.null(), loan_flow: z.null(), deleted_at: z.null(),
  loan_event: z.null().default(null), loan_principal_minor: z.null().default(null),
  loan_fee_minor: z.null().default(null), loan_event_seq: z.null().default(null),
  // Cashier metadata is part of the canonical parent projection too. Linked
  // payments cannot be cash settlements, but do not strip these fields before
  // calling the shared mapper when its settlement DTO is extended.
  tender_minor: z.null(), change_wallet_id: z.null(), change_minor: z.null(), change_currency: z.null(),
  change_rate_base: z.null(), change_rate_quote: z.null(), change_rate_numerator: z.null(), change_rate_denominator: z.null(),
  expense_items: z.object({ id: z.uuid(), description: z.string().min(1).max(140), amount_minor: positiveMinor,
    position: z.number().int().min(0).max(49) }).array().max(50),
}).passthrough();
const snapshotRows = z.object({
  receipt: z.object({ id: z.uuid(), occurred_on: z.iso.date(), created_at: recordedTime }).nullable(),
  installments: installmentRow.array(), payments: paymentRow.array(),
});

/** A safe read error is materially different from an empty/unpaid catalogue. */
function unavailable(): Error {
  return new Error("installment_cycle_snapshot_unavailable");
}

export function parseCycleSnapshot(payload: unknown): InstallmentCycleSnapshot {
  try {
    const rows = snapshotRows.parse(payload);
    const itemsById = new Map(rows.installments.map((item) => [item.id, item]));
    if (itemsById.size !== rows.installments.length) throw unavailable();
    const seenPayments = new Set<string>();
    const byInstallment = new Map<string, InstallmentPayment[]>();
    for (const p of rows.payments) {
      if (seenPayments.has(p.id) || itemsById.get(p.installment_id)?.currency !== p.currency) throw unavailable();
      const lineIds = new Set(p.expense_items.map((line) => line.id));
      const positions = new Set(p.expense_items.map((line) => line.position));
      const itemized = p.expense_items.reduce((sum, line) => sum + BigInt(line.amount_minor), 0n);
      if (lineIds.size !== p.expense_items.length || positions.size !== p.expense_items.length || itemized > BigInt(p.amount_minor)) throw unavailable();
      seenPayments.add(p.id);
      const payments = byInstallment.get(p.installment_id) ?? [];
      payments.push({ transactionId: p.id, amountMinor: p.amount_minor, occurredOn: p.occurred_on,
        createdAt: p.created_at, walletId: p.wallet_id, salaryCycleId: p.salary_cycle_id, revision: p.revision,
        transaction: toTransaction(p) });
      byInstallment.set(p.installment_id, payments);
    }
    const receipt = rows.receipt === null ? null : {
      id: rows.receipt.id, occurredOn: rows.receipt.occurred_on, createdAt: rows.receipt.created_at,
    };
    const installments = rows.installments.map((i) => withProgress({
      id: i.id, name: i.name, currency: i.currency, walletId: i.wallet_id, categoryId: i.category_id,
      totalMinor: i.total_minor, paidBeforeMinor: i.paid_before_minor, monthlyMinor: i.monthly_minor, dueDay: i.due_day,
    }, byInstallment.get(i.id) ?? [], receipt?.id ?? null));
    return { receipt, installments };
  } catch {
    // Reject malformed/unsafe money and incomplete snapshots without leaking raw
    // row contents, schema errors, session diagnostics, or a false zero balance.
    throw unavailable();
  }
}

/** One RLS-protected statement snapshot; share it across this request's readers. */
export const getCycleSnapshot = cache(async (timezone = "Asia/Beirut"): Promise<InstallmentCycleSnapshot> => {
  if (!supabaseConfigured()) return { receipt: demoSalaryReceipt(timezone), installments: demoInstallments(timezone) };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("installment_cycle_snapshot");
    if (error) throw unavailable();
    return parseCycleSnapshot(data);
  } catch {
    throw unavailable();
  }
});
