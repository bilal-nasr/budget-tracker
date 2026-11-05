"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient, type ActionResult } from "@/lib/supabase/action";
import { fetchTransactions } from "./queries";
import { todayIn } from "./group";
import {
  createTransactionCore, updateTransactionCore, deleteTransactionCore, restoreTransactionCore,
  transactionMutationError, type TransactionMutation,
} from "./mutations-core";
import {
  cursorSchema,
  filtersSchema,
  transferInputSchema,
  type Cursor,
  type Filters,
  type Page,
  type TransactionInput,
  type TransferInput,
} from "./schema";

const idSchema = z.uuid();

/** Restricted historical correction: never accepts a ledger amount or balance reference. */
export async function correctTransactionNote(id: string, expectedRevision: number, input: { note: string }): Promise<ActionResult<TransactionMutation>> {
  const parsed = z.strictObject({ note: z.string().trim().max(140) }).safeParse(input);
  if (!idSchema.safeParse(id).success || !z.number().int().min(1).max(2_147_483_647).safeParse(expectedRevision).success || !parsed.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.from("transactions").update({ note: parsed.data.note || null })
      .eq("id", id).eq("user_id", ctx.userId).eq("revision", expectedRevision).is("deleted_at", null).select("id, revision").maybeSingle();
    if (error) return { ok: false, error: transactionMutationError(error) };
    if (!data) return { ok: false, error: "conflict" };
    if (data.id !== id || !Number.isInteger(data.revision) || data.revision <= expectedRevision) return { ok: false, error: "failed" };
    revalidatePath("/", "layout");
    return { ok: true, id: data.id, revision: data.revision };
  } catch { return { ok: false, error: "failed" }; }
}

/** Date-only correction for any activity kind (loans and transfers included); amounts and wallets never change. */
export async function correctTransactionDate(id: string, expectedRevision: number, date: string): Promise<ActionResult<TransactionMutation>> {
  const parsedDate = z.iso.date().refine((value) => value >= "2000-01-01").safeParse(date);
  if (!idSchema.safeParse(id).success || !z.number().int().min(1).max(2_147_483_647).safeParse(expectedRevision).success || !parsedDate.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const owner = await ctx.supabase.from("profiles").select("timezone").eq("user_id", ctx.userId).maybeSingle();
    if (owner.error || !owner.data) return { ok: false, error: "failed" };
    if (parsedDate.data > todayIn(owner.data.timezone)) return { ok: false, error: "invalid" };
    const { data, error } = await ctx.supabase.rpc("set_transaction_date", { p_id: id, p_expected_revision: expectedRevision, p_date: parsedDate.data });
    if (error) return { ok: false, error: transactionMutationError(error) };
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || row.id !== id || !Number.isInteger(row.revision) || row.revision <= expectedRevision) return { ok: false, error: "failed" };
    revalidatePath("/", "layout");
    return { ok: true, id: row.id, revision: row.revision };
  } catch { return { ok: false, error: "failed" }; }
}

export async function createTransaction(
  input: TransactionInput,
  draftId: string,
): Promise<ActionResult<TransactionMutation>> {
  return createTransactionCore(input, draftId);
}

/**
 * Moves or exchanges between exact balances. The locked database boundary
 * checks ownership, enabled currency, live wallets and equal same-currency amounts.
 */
export async function createTransfer(input: TransferInput): Promise<ActionResult<TransactionMutation>> {
  const parsed = transferInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid" };
  }
  const ctx = await actionClient(parsed.data.expectedUnits);
  if (ctx.error) return { ok: false, error: ctx.error };

  const { data, error } = await ctx.supabase.rpc("record_balance_transfer", {
    p_request_id: parsed.data.requestId,
    p_occurred_on: parsed.data.occurredOn,
    p_from_balance_id: parsed.data.sourceBalanceId,
    p_to_balance_id: parsed.data.destinationBalanceId,
    p_from_amount_minor: parsed.data.sentMinor,
    p_to_amount_minor: parsed.data.receivedMinor,
    p_note: parsed.data.note || null,
    p_usd_lbp_rate: parsed.data.rate ?? null,
  });
  if (error) return { ok: false, error: transactionMutationError(error) };
  const result = z.array(z.object({ id: idSchema, revision: z.number().int().min(1).max(2_147_483_647) })).length(1).safeParse(data);
  if (!result.success) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true, ...result.data[0] };
}

export async function updateTransaction(
  id: string,
  input: TransactionInput,
  expectedRevision: number,
): Promise<ActionResult<TransactionMutation>> {
  return updateTransactionCore(id, input, expectedRevision);
}

/** Soft delete: the row stays for undo. */
export async function deleteTransaction(id: string, expectedRevision: number): Promise<ActionResult<TransactionMutation>> {
  return deleteTransactionCore(id, expectedRevision);
}

export async function restoreTransaction(id: string, expectedRevision: number): Promise<ActionResult<TransactionMutation>> {
  return restoreTransactionCore(id, expectedRevision);
}

/** Next page of the activity list, called from the client's "Load more". */
export async function loadTransactions(
  filters: Filters,
  cursor: Cursor | null,
): Promise<Page> {
  const f = filtersSchema.safeParse(filters);
  const c = cursor === null ? { success: true as const, data: null } : cursorSchema.safeParse(cursor);
  if (!f.success || !c.success) return { rows: [], next: null };
  return fetchTransactions(f.data, c.data);
}
