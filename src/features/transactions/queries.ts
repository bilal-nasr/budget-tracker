import "server-only";
import { demoPage } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import type { Cursor, Filters, Page, Transaction } from "./schema";

export const PAGE_SIZE = 30;

const COLUMNS =
  "id, kind, occurred_on, amount_minor, currency, wallet_id, category_id, note, created_at";

type Row = {
  id: string;
  kind: "expense" | "income";
  occurred_on: string;
  amount_minor: number | string;
  currency: "USD" | "LBP";
  wallet_id: string;
  category_id: string;
  note: string | null;
  created_at: string;
};

const toTransaction = (r: Row): Transaction => ({
  id: r.id,
  kind: r.kind,
  occurredOn: r.occurred_on,
  amountMinor: Number(r.amount_minor),
  currency: r.currency,
  walletId: r.wallet_id,
  categoryId: r.category_id,
  note: r.note,
  createdAt: r.created_at,
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
    .select(COLUMNS)
    .is("deleted_at", null)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.walletId) query = query.eq("wallet_id", filters.walletId);
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  if (filters.from) query = query.gte("occurred_on", filters.from);
  if (filters.to) query = query.lte("occurred_on", filters.to);
  if (filters.q) {
    const escaped = filters.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    query = query.ilike("note", `%${escaped}%`);
  }
  if (cursor) {
    const { occurredOn: d, createdAt: t, id } = cursor;
    query = query.or(
      `occurred_on.lt.${d},and(occurred_on.eq.${d},created_at.lt."${t}"),and(occurred_on.eq.${d},created_at.eq."${t}",id.lt.${id})`,
    );
  }

  const { data, error } = await query;
  if (error || !data) {
    console.error("[fetchTransactions]", error?.message);
    return { rows: [], next: null };
  }

  const rows = (data as Row[]).slice(0, limit).map(toTransaction);
  const last = rows[rows.length - 1];
  const next =
    data.length > limit && last
      ? { occurredOn: last.occurredOn, createdAt: last.createdAt, id: last.id }
      : null;
  return { rows, next };
}
