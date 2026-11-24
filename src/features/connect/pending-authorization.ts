import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * An AI assistant app asking to connect sends the person to `/connect?authorization_id=…`.
 * A signed-out visitor is sent to sign in first; the proxy remembers the authorization id
 * in this cookie so that, after signing in (or confirming their email, or finishing
 * onboarding), they come back to the consent screen. The cookie only ever holds an id;
 * the path is rebuilt from it, never read from it.
 */
export const AUTHORIZATION_COOKIE = "connect_authorization";
// Supabase's authorization requests are short-lived; an hour is plenty to sign in.
const HOUR_SECONDS = 60 * 60;

/** The shape of an authorization id. It goes into a Supabase Auth URL path, so nothing else is allowed. */
export const authorizationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);

/** `/connect?authorization_id=<id>` (locale added by the router), or null for anything that is not an id. */
export function connectPathFor(value: unknown): string | null {
  const id = authorizationIdSchema.safeParse(value);
  return id.success ? `/connect?authorization_id=${id.data}` : null;
}

/** The cookie the proxy sets for `response.cookies.set(...)`, or null when `id` is not an authorization id. */
export function rememberAuthorization(id: string, { secure = false }: { secure?: boolean } = {}) {
  if (!authorizationIdSchema.safeParse(id).success) return null;
  return { name: AUTHORIZATION_COOKIE, value: id, path: "/", httpOnly: true, sameSite: "lax" as const, maxAge: HOUR_SECONDS, secure };
}

/** Whether an authorization is remembered (a cheap cookie read, so callers can skip auth work when there is none). */
export async function hasPendingAuthorization(): Promise<boolean> {
  return (await cookies()).get(AUTHORIZATION_COOKIE)?.value !== undefined;
}

/** Forgets the remembered authorization, e.g. on sign-out or once it is decided (Server Actions and Route Handlers only). */
export async function forgetPendingAuthorization(): Promise<void> {
  (await cookies()).delete(AUTHORIZATION_COOKIE);
}

/** Reads and clears the remembered authorization, as its connect path (Server Actions and Route Handlers only). */
export async function takePendingAuthorization(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(AUTHORIZATION_COOKIE)?.value;
  if (value === undefined) return null;
  store.delete(AUTHORIZATION_COOKIE);
  return connectPathFor(value);
}

/**
 * Where to go after a sign-in or email confirmation when an authorization was remembered.
 * Same rule as a share link: a new account finishes onboarding first, so the authorization
 * is left in place for the end of onboarding instead of being used up here.
 */
export async function pendingAuthorizationAfterSignIn(supabase: Pick<SupabaseClient, "from">, userId: string): Promise<string | null> {
  const store = await cookies();
  const value = store.get(AUTHORIZATION_COOKIE)?.value;
  if (value === undefined) return null;
  if (!connectPathFor(value)) return takePendingAuthorization();
  const { data, error } = await supabase.from("profiles").select("onboarded_at").eq("user_id", userId).maybeSingle();
  if (error || !(data as { onboarded_at?: string | null } | null)?.onboarded_at) return null;
  return takePendingAuthorization();
}
