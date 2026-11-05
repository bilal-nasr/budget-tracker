"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ExpectedUnits } from "@/lib/currency-intent";
import { getCurrencies } from "@/features/currencies/queries";
import { readMinor } from "@/lib/money";
import { readAllByKey } from "@/lib/supabase/read-all";
import { getWallets } from "./queries";
import { buildWalletDeletionPlan, type WalletDeletionDependency, type WalletDeletionPlan, type WalletSettlement } from "./deletion";
import { actionClient, databaseActionError, type ActionResult } from "@/lib/supabase/action";
import {
  walletCreateInputSchema,
  walletUpdateInputSchema,
  type WalletCreateInput,
  type WalletUpdateInput,
} from "./schema";

const uuid = z.uuid();

/** Advisory read; the atomic RPC rechecks every dependency and balance under lock. */
export async function inspectWalletDeletion(walletId: string): Promise<ActionResult<{ plan: WalletDeletionPlan }>> {
  if (!uuid.safeParse(walletId).success) return { ok: false, error: "invalid" };
  const ctx = await safeActionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  try {
    const [wallets, currencies] = await Promise.all([
      getWallets({ includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true }),
      getCurrencies(),
    ]);
    const source = wallets.find((wallet) => wallet.id === walletId && !wallet.deleted);
    if (!source) return { ok: false, error: "walletUnavailable" };
    const balanceIds = new Set(source.balances.map((balance) => balance.id));
    const sourceIds = [...balanceIds];
    const [profileResult, fixed, installments, progress, loans] = await Promise.all([
      // user_id is the profile primary key: this owner-scoped read has at most one row.
      ctx.supabase.from("profiles").select("salary_balance_id").eq("user_id", ctx.userId),
      readAllByKey(async (after, limit) => {
        let query = ctx.supabase.from("fixed_expenses").select("id, name, balance_id").eq("user_id", ctx.userId).in("balance_id", sourceIds).order("id").limit(limit);
        if (after !== null) query = query.gt("id", after);
        return query;
      }, (row) => row.id, "Wallet inspection unavailable"),
      readAllByKey(async (after, limit) => {
        let query = ctx.supabase.from("installments").select("id, name, balance_id").eq("user_id", ctx.userId).in("balance_id", sourceIds).order("id").limit(limit);
        if (after !== null) query = query.gt("id", after);
        return query;
      }, (row) => row.id, "Wallet inspection unavailable"),
      readAllByKey(async (after, limit) => {
        let query = ctx.supabase.from("installment_progress").select("installment_id, remaining_minor").eq("user_id", ctx.userId).order("installment_id").limit(limit);
        if (after !== null) query = query.gt("installment_id", after);
        return query;
      }, (row) => row.installment_id, "Wallet inspection unavailable"),
      readAllByKey(async (after, limit) => {
        let query = ctx.supabase.from("loan_progress").select("id, name, balance_id, remaining_minor, deleted_at").eq("user_id", ctx.userId).in("balance_id", sourceIds).order("id").limit(limit);
        if (after !== null) query = query.gt("id", after);
        return query;
      }, (row) => row.id, "Wallet inspection unavailable"),
    ]);
    if (profileResult.error || !profileResult.data) return { ok: false, error: "failed" };
    const dependencies: WalletDeletionDependency[] = [];
    for (const row of profileResult.data) if (balanceIds.has(String(row.salary_balance_id))) dependencies.push({ kind: "salary", balanceId: String(row.salary_balance_id) });
    for (const row of fixed) if (balanceIds.has(String(row.balance_id))) dependencies.push({ kind: "fixedExpense", balanceId: String(row.balance_id), id: String(row.id), name: String(row.name) });
    for (const row of installments) {
      if (!balanceIds.has(String(row.balance_id))) continue;
      const matching = progress.filter((item) => item.installment_id === row.id);
      if (matching.length !== 1 || matching[0].remaining_minor == null) return { ok: false, error: "failed" };
      if (readMinor(matching[0].remaining_minor as string | number) > 0) dependencies.push({ kind: "installment", balanceId: String(row.balance_id), id: String(row.id), name: String(row.name) });
    }
    for (const row of loans) if (balanceIds.has(String(row.balance_id)) && row.deleted_at === null && readMinor(row.remaining_minor as string | number) > 0) dependencies.push({ kind: "loan", balanceId: String(row.balance_id), id: String(row.id), name: String(row.name) });
    return { ok: true, plan: buildWalletDeletionPlan(walletId, wallets, currencies, dependencies) };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function settleAndDeleteWallet(requestId: string, walletId: string, settlements: WalletSettlement[]): Promise<ActionResult> {
  const parsed = z.array(z.strictObject({ balanceId: uuid, counterpartBalanceId: uuid.nullable(), expectedAmountMinor: z.number().int().safe(), expectedUnit: z.strictObject({ code: z.string().regex(/^[A-Z][A-Z0-9]{0,11}$/), decimalPlaces: z.number().int().min(0).max(8) }) }).refine((entry) => entry.balanceId !== entry.counterpartBalanceId))
    .refine((entries) => new Set(entries.map((entry) => entry.balanceId)).size === entries.length).safeParse(settlements);
  if (!uuid.safeParse(requestId).success || !uuid.safeParse(walletId).success || !parsed.success) return { ok: false, error: "invalid" };
  const ctx = await safeActionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  try {
    const { error } = await ctx.supabase.rpc("settle_and_delete_wallet", { p_request_id: requestId, p_wallet_id: walletId, p_settlements: parsed.data });
    if (error) return { ok: false, error: databaseActionError(error) };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function reorderWallets(ids: string[]): Promise<ActionResult> {
  const parsed = z.array(uuid).refine((items) => new Set(items).size === items.length).safeParse(ids);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ctx = await safeActionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  try {
    // The RPC verifies this is the complete owner-scoped ordinary active list.
    const { error } = await ctx.supabase.rpc("reorder_wallets", { p_ids: parsed.data });
    if (error) return { ok: false, error: databaseActionError(error) };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

async function safeActionClient(expectedUnits?: ExpectedUnits) {
  try {
    return await actionClient(expectedUnits);
  } catch {
    return { error: "failed" as const };
  }
}

async function rpcAction(
  name: "set_wallet_default",
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
): Promise<ActionResult<{ id: string }>> {
  const parsed = walletCreateInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ctx = await safeActionClient(parsed.data.expectedUnits);
  if (ctx.error) return { ok: false, error: ctx.error };
  try {
    const { data, error } = await ctx.supabase.rpc("create_wallet", {
      p_name: parsed.data.name,
      p_kind: parsed.data.kind,
      p_default_currency: parsed.data.currency,
      p_opening_minor: parsed.data.openingBalanceMinor,
    });
    if (error || typeof data !== "string" || !uuid.safeParse(data).success) return { ok: false, error: error ? databaseActionError(error) : "failed" };
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

export async function setDefaultWalletBalance(walletId: string, balanceId: string): Promise<ActionResult> {
  if (!uuid.safeParse(walletId).success || !uuid.safeParse(balanceId).success) return { ok: false, error: "invalid" };
  return rpcAction("set_wallet_default", { p_wallet_id: walletId, p_balance_id: balanceId });
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
