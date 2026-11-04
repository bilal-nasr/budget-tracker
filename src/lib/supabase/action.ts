import "server-only";
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
  | "loanClosed" | "paymentOrder" | "termsLocked" | "managedTransaction";
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: ActionError };

/** Signed-in Supabase client for a Server Action, or the reason there is none. */
type Ctx =
  | { error: ActionError; supabase?: undefined; userId?: undefined }
  | { error?: undefined; supabase: SupabaseClient; userId: string };

export async function actionClient(): Promise<Ctx> {
  if (!supabaseConfigured()) return { error: "notConfigured" };
  const userId = await getUserId();
  if (!userId) return { error: "failed" };
  return { supabase: await createClient(), userId };
}
