import { createClient, isAuthError, isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isAllowedClient } from "./clients";

/** `sessionId` is the token's Supabase session; always set for an app token, null only for an ordinary session's when absent. */
export type VerifiedToken = { userId: string; clientId: string; sessionId: string | null; expiresAt: number; scopes: string[] };

// The canonical lower-case form Supabase Auth issues (the database guard accepts only this too).
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Built once per project address. It keeps no session and has no cookie access, so
// sharing it across requests shares nothing but the signing-key cache.
let verifier: { key: string; client: SupabaseClient } | null = null;
function verifierClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const key = `${url}\n${publishable}`;
  if (verifier?.key !== key) {
    verifier = {
      key,
      client: createClient(url, publishable, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    };
  }
  return verifier.client;
}

const claimsShape = z.object({
  sub: z.uuid(),
  role: z.literal("authenticated"),
  exp: z.number().finite(),
  // "session" is how a token with no client_id is reported, so no claim may carry it.
  client_id: z.string().min(1).refine((id) => id !== "session").optional(),
  scope: z.string().optional(),
  session_id: z.unknown().optional(),
});

const invalidToken = () => new OAuthError(OAuthErrorCode.InvalidToken, "The access token is invalid or expired");

/** Supabase Auth could not be reached or failed itself: nothing is known about the token. */
const authOutage = () => new Error("Token check unavailable");

/** A network failure (auth-js reports it as a retryable fetch error) or a 5xx from Supabase Auth. */
function isOutage(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  const status = isAuthError(error) ? error.status : undefined;
  return typeof status === "number" && status >= 500;
}

/**
 * A throw that escaped getClaims because the network failed: an abort or timeout, or the
 * TypeError fetch raises for a failed request (undici: "fetch failed", with a `cause`).
 * auth-js normally returns fetch failures as `{ error }`; anything else thrown comes from
 * decoding or verifying the token itself (bad JSON, bad UTF-8, bad alg, WebCrypto errors).
 */
function isNetworkThrow(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  if (name === "AbortError" || name === "TimeoutError") return true;
  return error instanceof TypeError && /fetch failed|failed to fetch|network ?error/i.test(error.message);
}

/**
 * Verifies a Supabase access token with Supabase Auth (getClaims checks the signature
 * and expiry) and returns who it belongs to. A token with no `client_id` claim (an ordinary
 * password session) reports clientId "session"; whether that, or the app named by a
 * `client_id`, may use `/mcp` is `bearerVerifier`'s decision, not this check's. A token with a
 * `client_id` must also carry a canonical `session_id` (its Supabase session), returned as `sessionId`.
 * A token Supabase rejects, or one too malformed to decode, throws the SDK's invalid-token
 * error (a 401). An outage (network failure, retryable fetch error or 5xx) throws a plain
 * Error instead, which the SDK answers with a 500, so a client does not discard a good token.
 */
export async function verifyAccessToken(token: string): Promise<VerifiedToken> {
  if (!token) throw invalidToken();
  let result: Awaited<ReturnType<SupabaseClient["auth"]["getClaims"]>>;
  try {
    result = await verifierClient().auth.getClaims(token);
  } catch (error) {
    throw isNetworkThrow(error) ? authOutage() : invalidToken();
  }
  const { data, error } = result;
  if (error && isOutage(error)) throw authOutage();
  if (error || !data) throw invalidToken();
  const raw: unknown = data.claims;
  const claims = claimsShape.safeParse(raw);
  if (!claims.success) throw invalidToken();
  const { sub, exp, client_id, scope, session_id } = claims.data;
  const sessionId = typeof session_id === "string" && SESSION_ID.test(session_id) ? session_id : null;
  // An app token is only as good as its session: /mcp's approved-app cache and the database
  // guard both key on it, so an app token without a well-formed one is invalid.
  if (client_id !== undefined && sessionId === null) throw invalidToken();
  return {
    userId: sub,
    clientId: client_id ?? "session",
    sessionId,
    expiresAt: exp,
    scopes: scope ? scope.split(" ").filter(Boolean) : [],
  };
}

/**
 * Approved apps only. A token issued to an app counts only if the owner registered that app
 * (`connector_clients`); an ordinary session token (clientId "session") counts only when
 * MCP_ALLOW_SESSION_TOKENS is exactly "1", which is for local testing and stays unset in
 * production. A lookup that could not be answered (network, timeout, 408, 429, 5xx) is an outage: a
 * plain Error, which the SDK answers with a 500, so a client does not discard a good token.
 */
async function clientAllowed(verified: VerifiedToken, token: string): Promise<boolean> {
  if (verified.clientId === "session") return process.env.MCP_ALLOW_SESSION_TOKENS === "1";
  try {
    return await isAllowedClient(verified.clientId, verified.sessionId ?? "", token);
  } catch {
    throw authOutage();
  }
}

/**
 * The verifier handed to the SDK's bearer gate: the token check, then the approved-app check,
 * both before any tool code runs. A refusal by either is a 401 invalid_token; an outage of
 * either is a plain Error (500). The verified user id rides in `extra`.
 */
export const bearerVerifier: OAuthTokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const verified = await verifyAccessToken(token);
    if (!(await clientAllowed(verified, token))) throw invalidToken();
    return {
      token,
      clientId: verified.clientId,
      scopes: verified.scopes,
      expiresAt: verified.expiresAt,
      extra: { userId: verified.userId },
    };
  },
};

/** The user id `bearerVerifier` put on a verified AuthInfo, or null. */
export function authInfoUserId(authInfo: AuthInfo | undefined): string | null {
  const userId = authInfo?.extra?.userId;
  return typeof userId === "string" && userId ? userId : null;
}
