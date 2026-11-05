"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient, databaseActionError, type ActionResult } from "@/lib/supabase/action";
import {
  walletBalanceInputSchema,
  walletCreateInputSchema,
  walletUpdateInputSchema,
  type WalletBalanceInput,
  type WalletCreateInput,
  type WalletFunding,
  type WalletUpdateInput,
} from "./schema";

const uuid = z.uuid();

async function safeActionClient() {
  try {
    return await actionClient();
  } catch {
    return { error: "failed" as const };
  }
}

async function rpcAction(
  name: "set_wallet_default" | "detach_wallet_balance",
  args: Record<string, string>,
): Promise<ActionResult> {
  const ctx = await safeActionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  try {
    const { error } = await ctx.supabase.rpc(name, args);
    if (error) return { ok: false, error: databaseActionError(error) };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function createWallet(
  input: WalletCreateInput,
  legacyFunding?: WalletFunding,
): Promise<ActionResult<{ id: string }>> {
  const parsed = walletCreateInputSchema.safeParse(input);
  if (!parsed.success || legacyFunding !== undefined) return { ok: false, error: "invalid" };
  const ctx = await safeActionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  try {
    const { data, error } = await ctx.supabase.rpc("create_wallet", {
      p_name: parsed.data.name,
      p_kind: parsed.data.kind,
      p_currency: parsed.data.currency,
      p_opening_minor: parsed.data.openingBalanceMinor,
    });
    if (error || typeof data !== "string") return { ok: false, error: error ? databaseActionError(error) : "failed" };
    revalidatePath("/", "layout");
    return { ok: true, id: data };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function updateWallet(id: string, input: WalletUpdateInput): Promise<ActionResult> {
  const parsed = walletUpdateInputSchema.safeParse(input);
  if (!uuid.safeParse(id).success || !parsed.success) return { ok: false, error: "invalid" };
  const ctx = await safeActionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  try {
    const { data, error } = await ctx.supabase.from("wallets")
      .update({ name: parsed.data.name, kind: parsed.data.kind })
      .eq("id", id)
      .eq("user_id", ctx.userId)
      .select("id")
      .maybeSingle();
    if (error || !data) return { ok: false, error: error ? databaseActionError(error) : "walletUnavailable" };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function addWalletBalance(walletId: string, input: WalletBalanceInput): Promise<ActionResult<{ id: string }>> {
  const parsed = walletBalanceInputSchema.safeParse(input);
  if (!uuid.safeParse(walletId).success || !parsed.success) return { ok: false, error: "invalid" };
  const ctx = await safeActionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  try {
    const { data, error } = await ctx.supabase.rpc("add_wallet_balance", {
      p_wallet_id: walletId,
      p_currency: parsed.data.currency,
    });
    if (error || typeof data !== "string") return { ok: false, error: error ? databaseActionError(error) : "failed" };
    revalidatePath("/", "layout");
    return { ok: true, id: data };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function setDefaultWalletBalance(walletId: string, balanceId: string): Promise<ActionResult> {
  if (!uuid.safeParse(walletId).success || !uuid.safeParse(balanceId).success) return { ok: false, error: "invalid" };
  return rpcAction("set_wallet_default", { p_wallet_id: walletId, p_balance_id: balanceId });
}

export async function detachWalletBalance(balanceId: string): Promise<ActionResult> {
  if (!uuid.safeParse(balanceId).success) return { ok: false, error: "invalid" };
  return rpcAction("detach_wallet_balance", { p_balance_id: balanceId });
}

export async function deleteWallet(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await safeActionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  try {
    const { error } = await ctx.supabase.rpc("delete_wallet", { p_id: id });
    if (error) {
      const legacy = { "wallet.invalid": "invalid", "wallet.hasTransactions": "hasTransactions" } as const;
      return { ok: false, error: legacy[error.message as keyof typeof legacy] ?? databaseActionError(error) };
    }
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/** @deprecated Archive/restore no longer exists; wallet deletion is permanent. */
export async function archiveWallet(_id: string): Promise<ActionResult> {
  void _id;
  return { ok: false, error: "invalid" };
}

/** @deprecated Archive/restore no longer exists; wallet deletion is permanent. */
export async function unarchiveWallet(_id: string): Promise<ActionResult> {
  void _id;
  return { ok: false, error: "invalid" };
}
