"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient, type ActionResult } from "@/lib/supabase/action";
import { todayIn } from "@/features/transactions/group";
import { getProfile } from "@/features/profile/queries";
import { walletInputSchema, walletFundingSchema, type WalletFunding, type WalletInput } from "./schema";

/**
 * Creates a wallet. By default its starting balance is new money. With
 * `funding`, the starting balance is instead taken from another wallet: the
 * new wallet starts at 0 and a move records the transfer in.
 */
export async function createWallet(
  input: WalletInput,
  funding?: WalletFunding,
): Promise<ActionResult<{ id: string }>> {
  const parsed = walletInputSchema.safeParse(input);
  const fund = funding === undefined ? undefined : walletFundingSchema.safeParse(funding);
  if (!parsed.success || (fund && !fund.success)) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const moved = fund?.success ? fund.data : undefined;
  const startMinor = parsed.data.openingBalanceMinor;
  if (moved && startMinor <= 0) return { ok: false, error: "invalid" };

  const { data, error } = await ctx.supabase
    .from("wallets")
    .insert({
      name: parsed.data.name,
      kind: parsed.data.kind,
      currency: parsed.data.currency,
      opening_balance_minor: moved ? 0 : startMinor,
      position: Math.floor(Date.now() / 1000),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "failed" };

  if (moved) {
    const profile = await getProfile();
    const { error: moveError } = await ctx.supabase.from("transactions").insert({
      kind: "transfer",
      occurred_on: todayIn(profile.timezone),
      wallet_id: moved.fromWalletId,
      amount_minor: moved.takenMinor,
      currency: "USD", // overwritten from the source wallet by the database trigger
      to_wallet_id: data.id,
      to_amount_minor: startMinor,
      note: "Starting balance",
    });
    if (moveError) {
      // Do not leave an empty wallet behind: archive, then delete (only archived wallets can be deleted).
      await ctx.supabase.from("wallets").update({ archived_at: new Date().toISOString() }).eq("id", data.id);
      await ctx.supabase.from("wallets").delete().eq("id", data.id);
      return { ok: false, error: "failed" };
    }
  }
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
 * Dependency checks, salary clearing and deletion share one database transaction.
 */
export async function deleteWallet(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  try {
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };

  const { error } = await ctx.supabase.rpc("delete_wallet", { p_id: id });
  if (error) {
    const known = { "wallet.invalid": "invalid", "wallet.hasTransactions": "hasTransactions", "wallet.inUse": "inUse" } as const;
    return { ok: false, error: known[error.message as keyof typeof known] ?? "failed" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}
