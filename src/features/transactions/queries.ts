import "server-only";
import { demoPage } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import type { Cursor, Filters, Page, Transaction } from "./schema";
import { readMinor, type Currency } from "@/lib/money";
import { SETTLEMENT_COLUMNS, readSettlementSnapshot, type SettlementRow } from "./settlement-serialization";
import { activityOrClause } from "./activity-filter";

export const PAGE_SIZE = 30;

export const TRANSACTION_COLUMNS =
  `id, kind, occurred_on, amount_minor, currency, wallet_id, category_id, to_wallet_id, to_amount_minor, note, created_at, revision, source, fixed_expense_id, installment_id, loan_id, loan_flow, loan_event, loan_principal_minor, loan_fee_minor, loan_event_seq, ${SETTLEMENT_COLUMNS}, expense_items!expense_items_transaction_owner_fkey(id,description,amount_minor,position)`;

export type TransactionRow = SettlementRow & {
  id: string;
  kind: Transaction["kind"];
  occurred_on: string;
  amount_minor: number | string;
  currency: Currency;
  wallet_id: string;
  category_id: string | null;
  to_wallet_id: string | null;
  to_amount_minor: number | string | null;
  note: string | null;
  created_at: string;
  revision: number;
  source: Transaction["source"];
  fixed_expense_id: string | null;
  installment_id: string | null;
  loan_id: string | null;
  loan_flow: "in" | "out" | null;
  loan_event: "disbursement" | "repayment" | null;
  loan_principal_minor: number | string | null;
  loan_fee_minor: number | string | null;
  loan_event_seq: number | null;
  expense_items: { id: string; description: string; amount_minor: number | string; position: number }[] | null;
};

export const toTransaction = (r: TransactionRow): Transaction => ({
  id: r.id,
  kind: r.kind,
  occurredOn: r.occurred_on,
  amountMinor: readMinor(r.amount_minor),
  currency: r.currency,
  walletId: r.wallet_id,
  categoryId: r.category_id,
  toWalletId: r.to_wallet_id,
  toAmountMinor: r.to_amount_minor === null ? null : readMinor(r.to_amount_minor),
  note: r.note,
  createdAt: r.created_at,
  revision: r.revision,
  settlement: readSettlementSnapshot(r, { kind: r.kind, currency: r.currency, amountMinor: readMinor(r.amount_minor) }),
  source: r.source ?? null,
  fixedExpenseId: r.fixed_expense_id ?? null,
  installmentId: r.installment_id ?? null,
  loanId: r.loan_id ?? null,
  loanFlow: r.loan_flow ?? null,
  loanEvent: r.loan_event ?? null,
  loanPrincipalMinor: r.loan_principal_minor == null ? null : readMinor(r.loan_principal_minor),
  loanFeeMinor: r.loan_fee_minor == null ? null : readMinor(r.loan_fee_minor),
  loanEventSeq: r.loan_event_seq ?? null,
  items: (r.expense_items ?? []).map((item) => ({
    id: item.id, description: item.description, amountMinor: readMinor(item.amount_minor), position: item.position,
  })).sort((a, b) => a.position - b.position),
});

/** One page of the activity feed, newest first, with a keyset cursor. */
export async function fetchTransactions(
  filters: Filters,
  cursor: Cursor | null,
  limit = PAGE_SIZE,
): Promise<Page> {
  if (!supabaseConfigured()) return demoPage(filters, cursor, limit);

  const supabase = await createClient();
  let query = supabase
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .is("deleted_at", null)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (filters.kind === "loan" || filters.kind === "transfer") query = query.eq("kind", filters.kind);
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  if (filters.from) query = query.gte("occurred_on", filters.from);
  if (filters.to) query = query.lte("occurred_on", filters.to);
  if (filters.q) {
    const escaped = filters.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    query = query.ilike("note", `%${escaped}%`);
  }
  const orClause = activityOrClause(filters, cursor);
  if (orClause) query = query.or(orClause);

  const { data, error } = await query;
  if (error || !data) {
    console.error("[fetchTransactions]", error?.message);
    return { rows: [], next: null };
  }

  const rows = (data as unknown as TransactionRow[]).slice(0, limit).map(toTransaction);
  const last = rows[rows.length - 1];
  const next =
    data.length > limit && last
      ? { occurredOn: last.occurredOn, createdAt: last.createdAt, id: last.id }
      : null;
  return { rows, next };
}
