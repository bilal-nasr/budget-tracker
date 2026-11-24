import { createClient } from "@supabase/supabase-js";

/** How long a "this app is registered" answer is trusted before asking the database again. */
const ALLOWED_FOR_MS = 60_000;
/** A lookup that has not answered by then is aborted and counts as an outage (500), not a refusal. */
const LOOKUP_TIMEOUT_MS = 5_000;
/** At most this many cached answers; beyond it the oldest is dropped (it is only asked again). */
export const ALLOWED_CACHE_MAX = 1_000;

// (client id, session id) → time (ms) until which that session of that app is known to be
// allowed. Only positive answers are kept. Every entry lives the same 60 s and is re-inserted
// when renewed, so insertion order is expiry order: pruning stops at the first live entry.
const allowedUntil = new Map<string, number>();
const cacheKey = (clientId: string, sessionId: string) => `${clientId}\u0000${sessionId}`;

function remember(key: string, until: number, now: number): void {
  allowedUntil.delete(key);
  for (const [entry, expires] of allowedUntil) {
    if (expires > now) break;
    allowedUntil.delete(entry);
  }
  while (allowedUntil.size >= ALLOWED_CACHE_MAX) {
    const oldest = allowedUntil.keys().next().value;
    if (oldest === undefined) break;
    allowedUntil.delete(oldest);
  }
  allowedUntil.set(key, until);
}

/**
 * The registry could not be asked: a network failure, a timeout, a 408, a 429 or a 5xx. Not a refusal, so the
 * caller answers it as an outage (a 500), never as a bad token. Carries no Supabase text.
 */
export class AllowlistUnavailableError extends Error {
  constructor() {
    super("Approved-app check unavailable");
    this.name = "AllowlistUnavailableError";
  }
}

/** Forgets every cached answer (tests, and nothing else). */
export function clearAllowedClientCache(): void {
  allowedUntil.clear();
}

/** How many answers are cached (tests, and nothing else). */
export function allowedClientCacheSize(): number {
  return allowedUntil.size;
}

/**
 * Whether `clientId` (a verified token's `client_id` claim) is an app the owner registered in
 * `public.connector_clients`, for the token's own session `sessionId`. The lookup runs with the
 * caller's own token, so it passes the database guard: a registered app's token whose session
 * still exists may read the table, while the guard refuses an unregistered app's token, or one
 * whose session is gone (the person removed the app), outright. So a missing row, or any 4xx
 * answer other than 408 and 429 (the guard's 403 / 42501 included), means "not allowed" (false).
 * An answer that never came or says "try again later" (a thrown or aborted fetch, a 5 s timeout,
 * status 0, 408 Request Timeout, 429 Too Many Requests or a 5xx) throws
 * AllowlistUnavailableError instead. Only a positive answer is cached, 60 s per app AND session,
 * so another person's use of the same app never keeps a removed session admitted. Removing an
 * app's row, or the person removing the app, therefore shuts that session out of `/mcp` within
 * 60 s; the database refuses its token at once.
 */
export async function isAllowedClient(clientId: string, sessionId: string, accessToken: string): Promise<boolean> {
  if (!clientId || !sessionId || !accessToken) return false;
  const key = cacheKey(clientId, sessionId);
  const now = Date.now();
  const until = allowedUntil.get(key);
  if (until !== undefined && until > now) return true;
  allowedUntil.delete(key);
  // setTimeout (not AbortSignal.timeout), so the abort is one ordinary timer that is always cleared.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Approved-app lookup timed out", "TimeoutError")), LOOKUP_TIMEOUT_MS);
  let result: { data: unknown; error: unknown; status: number };
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    result = await db
      .from("connector_clients")
      .select("client_id")
      .eq("client_id", clientId)
      .abortSignal(controller.signal)
      .maybeSingle();
  } catch {
    throw new AllowlistUnavailableError();
  } finally {
    clearTimeout(timer);
  }
  const { data, error, status } = result;
  // postgrest-js reports a failed or aborted fetch as status 0. 408 and 429 mean "ask again later".
  if (error && (typeof status !== "number" || status === 0 || status === 408 || status === 429 || status >= 500)) {
    throw new AllowlistUnavailableError();
  }
  const row: unknown = data;
  const listed = !error && typeof row === "object" && row !== null && (row as { client_id?: unknown }).client_id === clientId;
  if (!listed) return false;
  // Timed from when the answer is stored, so overlapping lookups still insert in expiry order.
  const stored = Date.now();
  remember(key, stored + ALLOWED_FOR_MS, stored);
  return true;
}
