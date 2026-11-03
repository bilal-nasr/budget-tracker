"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient, type ActionResult } from "@/lib/supabase/action";
import { walletInputSchema, type WalletInput } from "./schema";

export async function createWallet(input: WalletInput): Promise<ActionResult<{ id: string }>> {
  const parsed = walletInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };

  const { data, error } = await ctx.supabase
    .from("wallets")
    .insert({
      name: parsed.data.name,
      kind: parsed.data.kind,
      currency: parsed.data.currency,
      opening_balance_minor: parsed.data.openingBalanceMinor,
      position: Math.floor(Date.now() / 1000),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}

export async function updateWallet(id: string, input: WalletInput): Promise<ActionResult> {
  const parsed = walletInputSchema.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };

  const { error } = await ctx.supabase
    .from("wallets")
    .update({
      name: parsed.data.name,
      kind: parsed.data.kind,
      currency: parsed.data.currency,
      opening_balance_minor: parsed.data.openingBalanceMinor,
    })
    .eq("id", id);
  // The database refuses a currency change once the wallet has transactions.
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function archiveWallet(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const { error } = await ctx.supabase
    .from("wallets")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function unarchiveWallet(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const { error } = await ctx.supabase.from("wallets").update({ archived_at: null }).eq("id", id);
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Permanently deletes an archived wallet that has no transactions. If it was
 * the salary wallet, the salary setting is cleared first (it needs a wallet).
 */
export async function deleteWallet(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };

  const { data: wallet } = await ctx.supabase.from("wallets").select("archived_at").eq("id", id).maybeSingle();
  if (!wallet || wallet.archived_at === null) return { ok: false, error: "invalid" };

  const { count } = await ctx.supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("wallet_id", id);
  if (count === null || count > 0) return { ok: false, error: "hasTransactions" };

  await ctx.supabase
    .from("profiles")
    .update({ salary_amount_minor: null, salary_wallet_id: null })
    .eq("user_id", ctx.userId)
    .eq("salary_wallet_id", id);

  const { error } = await ctx.supabase.from("wallets").delete().eq("id", id);
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}
