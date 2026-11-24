import "server-only";
import { cache } from "react";
import { connectorContext } from "./request-context";
import { createClient } from "./server";

/**
 * The cookie session's user id, or null. Uses getClaims, which verifies the JWT
 * locally when the project signs with asymmetric keys (one network round trip
 * fewer per call than getUser), and once per request.
 */
const getCookieUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims.sub ?? null;
});

/**
 * The signed-in user's id, or null. A connector request answers from its own
 * context; that check sits outside `cache` so a connector identity is never memoised.
 */
export async function getUserId(): Promise<string | null> {
  const connector = connectorContext();
  if (connector) return connector.userId;
  return getCookieUserId();
}

/** The signed-in user's email (verified with Supabase Auth), or null. */
export async function getUserEmail(): Promise<string | null> {
  const connector = connectorContext();
  const supabase = await createClient();
  const { data } = connector ? await supabase.auth.getUser(connector.accessToken) : await supabase.auth.getUser();
  return data.user?.email ?? null;
}
