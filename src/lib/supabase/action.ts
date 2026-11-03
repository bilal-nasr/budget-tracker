import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./server";
import { supabaseConfigured } from "./proxy";

export type ActionError = "invalid" | "notConfigured" | "failed" | "hasTransactions";
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: ActionError };

/** Signed-in Supabase client for a Server Action, or the reason there is none. */
type Ctx =
  | { error: ActionError; supabase?: undefined; userId?: undefined }
  | { error?: undefined; supabase: SupabaseClient; userId: string };

export async function actionClient(): Promise<Ctx> {
  if (!supabaseConfigured()) return { error: "notConfigured" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "failed" };
  return { supabase, userId: data.user.id };
}
