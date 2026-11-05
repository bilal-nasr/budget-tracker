import "server-only";
import { expectedUnitsSchema, type ExpectedUnits } from "@/lib/currency-intent";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./server";
import { supabaseConfigured } from "./proxy";
import { getUserId } from "./user";

export type ActionError =
  | "invalid" | "notConfigured" | "failed" | "hasTransactions" | "inUse"
  | "exceedsRemaining" | "totalBelowPaid" | "duplicateName" | "categoryUnavailable"
  | "breakdownExceedsTotal" | "breakdownCurrencyLocked" | "conflict"
  | "walletUnavailable" | "settlementMismatch" | "unsupportedPair"
  | "alreadyPaidThisCycle" | "cycleChanged" | "paymentChanged" | "requestAlreadyUsed"
  | "loanClosed" | "paymentOrder" | "termsLocked" | "managedTransaction"
  | "duplicateCurrency" | "currencyUnavailable" | "currencyDisabled" | "currencyUsed"
  | "currencyNonzero" | "currencyInUse" | "lastEnabledCurrency" | "lastWalletBalance"
  | "balanceUnavailable" | "balanceDetached" | "balanceNonzero" | "balanceInUse"
  | "invalidDefault" | "walletDeleted" | "walletNeedsAttention" | "walletNonzero"
  | "reorderConflict" | "deletionConflict";
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: ActionError };

/** Signed-in Supabase client for a Server Action, or the reason there is none. */
type Ctx =
  | { error: ActionError; supabase?: undefined; userId?: undefined }
  | { error?: undefined; supabase: SupabaseClient; userId: string };

export async function actionClient(expectedUnits?: ExpectedUnits): Promise<Ctx> {
  if (!supabaseConfigured()) return { error: "notConfigured" };
  const userId = await getUserId();
  if (!userId) return { error: "failed" };
  return { supabase: await createClient(expectedUnits ? { "x-budget-units": JSON.stringify(expectedUnitsSchema.parse(expectedUnits)) } : undefined), userId };
}

type DatabaseError = { code?: string; message?: string } | null | undefined;

const databaseErrors: Readonly<Record<string, ActionError>> = {
  "currency.intentConflict": "conflict",
  "currency.lifecycleRequired": "conflict",
  "currency.incompleteCoverage": "conflict",
  "balance.globalCurrency": "conflict",
  "currency.unavailable": "currencyUnavailable",
  "currency.disabled": "currencyDisabled",
  "currency.used": "currencyUsed",
  "currency.nonzero": "currencyNonzero",
  "currency.inUse": "currencyInUse",
  "currency.lastEnabled": "lastEnabledCurrency",
  "currency.lastBalance": "lastWalletBalance",
  "balance.unavailable": "balanceUnavailable",
  "balance.detached": "balanceDetached",
  "balance.nonzero": "balanceNonzero",
  "balance.inUse": "balanceInUse",
  "wallet.unavailable": "walletUnavailable",
  "wallet.deleted": "walletDeleted",
  "wallet.needsAttention": "walletNeedsAttention",
  "wallet.invalidDefault": "invalidDefault",
  "wallet.nonzero": "walletNonzero",
  "wallet.inUse": "inUse",
  "wallet.reorderConflict": "reorderConflict",
  "wallet.invalidSettlement": "settlementMismatch",
  "wallet.deletionConflict": "deletionConflict",
};

/** Stable public error mapping; unknown database diagnostics never cross the action boundary. */
export function databaseActionError(error: DatabaseError): ActionError {
  if (error?.code === "40001" || error?.code === "40P01") return "conflict";
  if (error?.code === "23505") return "duplicateCurrency";
  return error?.message ? (databaseErrors[error.message] ?? "failed") : "failed";
}
