"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { TRANSACTION_COLUMNS, toTransaction, type TransactionRow } from "@/features/transactions/queries";
import type { Transaction } from "@/features/transactions/schema";

const cursorSchema = z.object({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() });
export type InstallmentHistoryCursor = z.infer<typeof cursorSchema>;
export type InstallmentHistoryPage = { rows: Transaction[]; next: InstallmentHistoryCursor | null };

/** Canonical parents (including revisions/items) only when an installment is opened. */
export async function loadInstallmentHistory(id: string, cursor: InstallmentHistoryCursor | null): Promise<InstallmentHistoryPage> {
  if (!z.uuid().safeParse(id).success || (cursor !== null && !cursorSchema.safeParse(cursor).success)) throw new Error("installment_history_unavailable");
  const supabase = await createClient();
  let query = supabase.from("transactions").select(TRANSACTION_COLUMNS).eq("installment_id", id).is("deleted_at", null)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(31);
  if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  const { data, error } = await query;
  if (error || !data) throw new Error("installment_history_unavailable");
  const rows = (data as unknown as TransactionRow[]).slice(0, 30).map(toTransaction);
  const last = rows.at(-1);
  return { rows, next: data.length > 30 && last ? { createdAt: last.createdAt, id: last.id } : null };
}
