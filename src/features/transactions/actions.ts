"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient, type ActionResult } from "@/lib/supabase/action";
import { fetchTransactions } from "./queries";
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

export async function createTransaction(
  input: TransactionInput,
  draftId: string,
): Promise<ActionResult<TransactionMutation>> {
  return createTransactionCore(input, draftId);
}

/**
 * Moves money between two of the owner's wallets. The database checks both
 * wallets are theirs and active, and that same-currency amounts are equal.
 */
export async function createTransfer(input: TransferInput): Promise<ActionResult<TransactionMutation>> {
  const parsed = transferInputSchema.safeParse(input);
  if (!parsed.success || parsed.data.fromWalletId === parsed.data.toWalletId) {
    return { ok: false, error: "invalid" };
  }
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };

  const { data, error } = await ctx.supabase.rpc("record_transfer", {
    p_occurred_on: parsed.data.occurredOn,
    p_from_wallet_id: parsed.data.fromWalletId,
    p_to_wallet_id: parsed.data.toWalletId,
    p_from_amount_minor: parsed.data.fromAmountMinor,
    p_to_amount_minor: parsed.data.toAmountMinor,
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
