import "server-only";
import { cache } from "react";
import { createClient } from "./server";

/**
 * The signed-in user's id, or null. Uses getClaims, which verifies the JWT
 * locally when the project signs with asymmetric keys (one network round trip
 * fewer per call than getUser), and once per request.
 */
export const getUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims.sub ?? null;
});
