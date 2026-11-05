"use server";

import { revalidatePath } from "next/cache";
import { actionClient, databaseActionError, type ActionResult } from "@/lib/supabase/action";
import { readMinor } from "@/lib/money";
import { currencyCodeSchema, currencyInputSchema, type CurrencyInput } from "./schema";

export type CurrencyDisableBlocker =
  | { kind: "lastEnabledCurrency" }
  | { kind: "nonzeroBalance"; balanceId: string; walletId: string; walletName: string }
  | { kind: "lastWalletBalance"; walletId: string; walletName: string }
  | { kind: "salary"; balanceId: string; walletId: string; walletName: string }
  | { kind: "fixedExpense"; id: string; name: string; balanceId: string }
  | { kind: "installment"; id: string; name: string; balanceId: string }
  | { kind: "loan"; id: string; name: string; balanceId: string }
  | { kind: "pendingPayment"; id: string; label: string }
  | { kind: "budget"; id: string; categoryId: string; startsMonth: string };

async function safeActionClient() {
  try {
    return await actionClient();
  } catch {
    return { error: "failed" as const };
  }
}

export async function createCurrency(input: CurrencyInput): Promise<ActionResult> {
  const parsed = currencyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ctx = await safeActionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  try {
    const { error } = await ctx.supabase.rpc("create_currency", {
      p_code: parsed.data.code,
      p_symbol: parsed.data.symbol,
      p_decimal_places: parsed.data.decimalPlaces,
    });
    if (error) return { ok: false, error: databaseActionError(error) };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function updateCurrency(currentCode: string, input: CurrencyInput): Promise<ActionResult> {
  const current = currencyCodeSchema.safeParse(currentCode);
  const parsed = currencyInputSchema.safeParse(input);
  if (!current.success || !parsed.success) return { ok: false, error: "invalid" };
  const ctx = await safeActionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  try {
    const { error } = await ctx.supabase.rpc("update_currency", {
      p_current_code: current.data,
      p_code: parsed.data.code,
      p_symbol: parsed.data.symbol,
      p_decimal_places: parsed.data.decimalPlaces,
    });
    if (error) return { ok: false, error: databaseActionError(error) };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function setCurrencyEnabled(code: string, enabled: boolean): Promise<ActionResult> {
  const parsed = currencyCodeSchema.safeParse(code);
  if (!parsed.success || typeof enabled !== "boolean") return { ok: false, error: "invalid" };
  const ctx = await safeActionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  try {
    const { error } = await ctx.supabase.rpc("set_currency_disabled", { p_code: parsed.data, p_disabled: !enabled });
    if (error) return { ok: false, error: databaseActionError(error) };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function deleteCurrency(code: string): Promise<ActionResult> {
  const parsed = currencyCodeSchema.safeParse(code);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ctx = await safeActionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  try {
    const { error } = await ctx.supabase.rpc("delete_currency", { p_code: parsed.data });
    if (error) return { ok: false, error: databaseActionError(error) };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

type ReadResult = { data: unknown[] | null; error: unknown };

/** Read-only preview of every condition that would reject the disable transaction. */
async function inspectCurrencyDisableUnsafe(code: string): Promise<CurrencyDisableBlocker[]> {
  const parsed = currencyCodeSchema.safeParse(code);
  const ctx = await safeActionClient();
  if (!parsed.success || ctx.error) throw new Error("Currency inspection unavailable");

  const results = await Promise.all([
    ctx.supabase.from("currencies").select("code, disabled_at"),
    ctx.supabase.from("wallets").select("id, name, default_balance_id, deleted_at, needs_attention"),
    ctx.supabase.from("wallet_balances").select("id, wallet_id, currency, detached_at"),
    ctx.supabase.from("wallet_balance_totals").select("balance_id, wallet_id, currency, balance_minor"),
    ctx.supabase.from("profiles").select("salary_balance_id"),
    ctx.supabase.from("fixed_expenses").select("id, name, balance_id"),
    ctx.supabase.from("installments").select("id, name, balance_id"),
    ctx.supabase.from("installment_progress").select("installment_id, remaining_minor"),
    ctx.supabase.from("loan_progress").select("id, name, balance_id, currency, remaining_minor, deleted_at"),
    ctx.supabase.from("pending_payment_progress").select("id, project, client, currency, remaining_minor, deleted_at"),
    ctx.supabase.from("budgets").select("id, category_id, currency, starts_month, limit_minor"),
  ]) as ReadResult[];
  if (results.some((result) => result.error || !result.data)) throw new Error("Currency inspection unavailable");

  const [currencyRows, walletRows, balanceRows, totalRows, profileRows, fixedRows, installmentRows, progressRows, loanRows, pendingRows, budgetRows]
    = results.map((result) => result.data!) as Array<Record<string, unknown>[]>;
  const target = parsed.data;
  if (!currencyRows.some((row) => row.code === target)) throw new Error("Currency inspection unavailable");

  const wallets = new Map(walletRows.map((row) => [String(row.id), row]));
  const balances = new Map(balanceRows.map((row) => [String(row.id), row]));
  const totals = new Map<string, Record<string, unknown>>();
  for (const row of totalRows) {
    const id = String(row.balance_id);
    if (totals.has(id)) throw new Error("Currency inspection unavailable");
    totals.set(id, row);
  }
  for (const balance of balanceRows) {
    const total = totals.get(String(balance.id));
    if (!total || total.wallet_id !== balance.wallet_id || total.currency !== balance.currency || total.balance_minor === null) {
      throw new Error("Currency inspection unavailable");
    }
  }
  if (totals.size !== balances.size || [...totals.keys()].some((id) => !balances.has(id))) {
    throw new Error("Currency inspection unavailable");
  }
  const enabled = new Set(currencyRows.filter((row) => row.disabled_at === null).map((row) => String(row.code)));
  const targetBalances = balanceRows.filter((row) => row.currency === target);
  const targetBalanceIds = new Set(targetBalances.map((row) => String(row.id)));
  const blockers: CurrencyDisableBlocker[] = [];

  if (enabled.has(target) && enabled.size === 1) blockers.push({ kind: "lastEnabledCurrency" });

  for (const row of totalRows) {
    if (row.currency !== target || row.balance_minor === null || readMinor(row.balance_minor as number | string) === 0) continue;
    const wallet = wallets.get(String(row.wallet_id));
    if (!wallet) throw new Error("Currency inspection unavailable");
    blockers.push({ kind: "nonzeroBalance", balanceId: String(row.balance_id), walletId: String(row.wallet_id), walletName: String(wallet.name) });
  }

  for (const wallet of walletRows) {
    if (wallet.deleted_at !== null || !targetBalanceIds.has(String(wallet.default_balance_id))) continue;
    const hasAlternative = balanceRows.some((balance) => balance.wallet_id === wallet.id
      && balance.id !== wallet.default_balance_id && balance.detached_at === null && enabled.has(String(balance.currency)) && balance.currency !== target);
    if (!hasAlternative) blockers.push({ kind: "lastWalletBalance", walletId: String(wallet.id), walletName: String(wallet.name) });
  }

  for (const profile of profileRows) {
    const balanceId = String(profile.salary_balance_id ?? "");
    if (!targetBalanceIds.has(balanceId)) continue;
    const balance = balances.get(balanceId);
    const wallet = balance && wallets.get(String(balance.wallet_id));
    if (!balance || !wallet) throw new Error("Currency inspection unavailable");
    blockers.push({ kind: "salary", balanceId, walletId: String(balance.wallet_id), walletName: String(wallet.name) });
  }
  for (const fixed of fixedRows) {
    if (targetBalanceIds.has(String(fixed.balance_id))) blockers.push({ kind: "fixedExpense", id: String(fixed.id), name: String(fixed.name), balanceId: String(fixed.balance_id) });
  }
  const remaining = new Map(progressRows.map((row) => [String(row.installment_id), readMinor(row.remaining_minor as number | string)]));
  for (const installment of installmentRows) {
    if (targetBalanceIds.has(String(installment.balance_id)) && (remaining.get(String(installment.id)) ?? 0) > 0) {
      blockers.push({ kind: "installment", id: String(installment.id), name: String(installment.name), balanceId: String(installment.balance_id) });
    }
  }
  for (const loan of loanRows) {
    if (loan.currency === target && loan.deleted_at === null && readMinor(loan.remaining_minor as number | string) > 0) {
      blockers.push({ kind: "loan", id: String(loan.id), name: String(loan.name), balanceId: String(loan.balance_id) });
    }
  }
  for (const pending of pendingRows) {
    if (pending.currency === target && pending.deleted_at === null && readMinor(pending.remaining_minor as number | string) > 0) {
      blockers.push({ kind: "pendingPayment", id: String(pending.id), label: `${String(pending.client)} · ${String(pending.project)}` });
    }
  }

  const currentMonth = `${new Date().toISOString().slice(0, 7)}-01`;
  const byCategory = new Map<string, Record<string, unknown>[]>();
  for (const budget of budgetRows.filter((row) => row.currency === target)) {
    const category = String(budget.category_id);
    byCategory.set(category, [...(byCategory.get(category) ?? []), budget]);
  }
  for (const [categoryId, rows] of byCategory) {
    const current = rows.filter((row) => String(row.starts_month) <= currentMonth)
      .sort((left, right) => String(right.starts_month).localeCompare(String(left.starts_month)))[0];
    if (current?.limit_minor !== null && current !== undefined) {
      blockers.push({ kind: "budget", id: String(current.id), categoryId, startsMonth: String(current.starts_month) });
    }
    for (const future of rows.filter((row) => String(row.starts_month) > currentMonth && row.limit_minor !== null)) {
      blockers.push({ kind: "budget", id: String(future.id), categoryId, startsMonth: String(future.starts_month) });
    }
  }

  return blockers;
}

export async function inspectCurrencyDisable(code: string): Promise<CurrencyDisableBlocker[]> {
  try {
    return await inspectCurrencyDisableUnsafe(code);
  } catch {
    throw new Error("Currency inspection unavailable");
  }
}
