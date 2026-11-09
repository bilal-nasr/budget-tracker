import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tokenSchema } from "./schema";

/**
 * A signed-out visitor who opens a share link is sent to sign in first. The proxy
 * remembers the link's token in this cookie so that, after signing in, signing up
 * (and confirming the email), or finishing onboarding, they land back on the join page.
 * The cookie only ever holds a token; the path is rebuilt from it, never read from it.
 */
export const JOIN_COOKIE = "join_invoice";
const DAY_SECONDS = 24 * 60 * 60;

/** `/invoices/join/<token>` (locale added by the router), or null for anything that is not a token. */
export function joinPathFor(value: unknown): string | null {
  const token = tokenSchema.safeParse(value);
  return token.success ? `/invoices/join/${token.data}` : null;
}

/** The cookie the proxy sets for `response.cookies.set(...)`, or null when `token` is not a link token. */
export function rememberJoin(token: string, { secure = false }: { secure?: boolean } = {}) {
  if (!tokenSchema.safeParse(token).success) return null;
  return { name: JOIN_COOKIE, value: token, path: "/", httpOnly: true, sameSite: "lax" as const, maxAge: DAY_SECONDS, secure };
}

/** Whether a link is remembered (a cheap cookie read, so callers can skip auth work when there is none). */
export async function hasPendingJoin(): Promise<boolean> {
  return (await cookies()).get(JOIN_COOKIE)?.value !== undefined;
}

/** Forgets the remembered link, e.g. on sign-out so the next person on a shared device does not land on it (Server Actions and Route Handlers only). */
export async function forgetPendingJoin(): Promise<void> {
  (await cookies()).delete(JOIN_COOKIE);
}

/** Reads and clears the remembered link (Server Actions and Route Handlers only). */
export async function takePendingJoin(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(JOIN_COOKIE)?.value;
  if (value === undefined) return null;
  store.delete(JOIN_COOKIE);
  return joinPathFor(value);
}

/**
 * Where to go after a sign-in or email confirmation when a link was remembered. A new
 * account has to finish onboarding first (the app sends it there anyway), so the link is
 * left in place for the end of onboarding instead of being used up here.
 */
export async function pendingJoinAfterSignIn(supabase: Pick<SupabaseClient, "from">, userId: string): Promise<string | null> {
  const store = await cookies();
  const value = store.get(JOIN_COOKIE)?.value;
  if (value === undefined) return null;
  if (!joinPathFor(value)) return takePendingJoin();
  const { data, error } = await supabase.from("profiles").select("onboarded_at").eq("user_id", userId).maybeSingle();
  if (error || !(data as { onboarded_at?: string | null } | null)?.onboarded_at) return null;
  return takePendingJoin();
}
