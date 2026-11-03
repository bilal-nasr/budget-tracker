"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient, type ActionResult } from "@/lib/supabase/action";
import { fetchTransactions } from "./queries";
import {
  cursorSchema,
  filtersSchema,
  transactionInputSchema,
  transferInputSchema,
  type Cursor,
  type Filters,
  type Page,
  type TransactionInput,
  type TransferInput,
} from "./schema";

const idSchema = z.uuid();

const row = (input: TransactionInput) => ({
  kind: input.kind,
  occurred_on: input.occurredOn,
  wallet_id: input.walletId,
  amount_minor: input.amountMinor,
  category_id: input.categoryId,
  note: input.note ? input.note : null,
});

export async function createTransaction(
  input: TransactionInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = transactionInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };

  // `currency` and ownership checks are enforced by the database trigger.
  const { data, error } = await ctx.supabase
    .from("transactions")
    .insert({ ...row(parsed.data), currency: "USD" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}

/**
 * Moves money between two of the owner's wallets. The database checks both
 * wallets are theirs and active, and that same-currency amounts are equal.
 */
export async function createTransfer(input: TransferInput): Promise<ActionResult<{ id: string }>> {
  const parsed = transferInputSchema.safeParse(input);
  if (!parsed.success || parsed.data.fromWalletId === parsed.data.toWalletId) {
    return { ok: false, error: "invalid" };
  }
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };

  const { data, error } = await ctx.supabase
    .from("transactions")
    .insert({
      kind: "transfer",
      occurred_on: parsed.data.occurredOn,
      wallet_id: parsed.data.fromWalletId,
      amount_minor: parsed.data.fromAmountMinor,
      currency: "USD", // overwritten from the source wallet by the database trigger
      to_wallet_id: parsed.data.toWalletId,
      to_amount_minor: parsed.data.toAmountMinor,
      note: parsed.data.note ? parsed.data.note : null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "failed" };

  // Remember the rate for next time. A failure here must not undo the move.
  if (parsed.data.rate !== undefined) {
    await ctx.supabase.from("profiles").update({ usd_lbp_rate: parsed.data.rate }).eq("user_id", ctx.userId);
  }
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}

export async function updateTransaction(
  id: string,
  input: TransactionInput,
): Promise<ActionResult> {
  const parsed = transactionInputSchema.safeParse(input);
  if (!parsed.success || !idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };

  const { error } = await ctx.supabase
    .from("transactions")
    .update({ ...row(parsed.data), currency: "USD" })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Soft delete: the row stays for undo. */
export async function deleteTransaction(id: string): Promise<ActionResult> {
  return setDeleted(id, new Date().toISOString());
}

export async function restoreTransaction(id: string): Promise<ActionResult> {
  return setDeleted(id, null);
}

async function setDeleted(id: string, deletedAt: string | null): Promise<ActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const { error } = await ctx.supabase
    .from("transactions")
    .update({ deleted_at: deletedAt })
    .eq("id", id);
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
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
