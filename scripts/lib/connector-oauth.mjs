// Shared by scripts/test-mcp.mjs and scripts/connector-smoke.mjs: a registered app's real
// OAuth tokens without a browser. Messages carry only statuses and error codes, never a token.
import { createHash, randomBytes } from "node:crypto";

/** The claims of a JWT (not verified; only for reading what Supabase put in it). */
export const claimsOf = (token) => JSON.parse(Buffer.from(String(token).split(".")[1] ?? "", "base64url").toString("utf8"));

const shortText = (value) => {
  const text = typeof value === "string" ? value : String(JSON.stringify(value));
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
};

function must(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Starts an authorization request for `clientId` with PKCE (S256), as Claude would, and returns
 * what the consent screen needs: `{ authorizationId, verifier, state }`.
 */
export async function startAuthorization({ apiUrl, publishable, clientId, redirectUri }) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(8).toString("hex");
  const query = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge,
    code_challenge_method: "S256", state, scope: "openid email",
  });
  const start = await fetch(`${apiUrl}/auth/v1/oauth/authorize?${query}`, { redirect: "manual", headers: { apikey: publishable } });
  await start.body?.cancel();
  const location = start.headers.get("location") ?? "";
  const authorizationId = location ? new URL(location, apiUrl).searchParams.get("authorization_id") : null;
  must(start.status >= 300 && start.status < 400 && authorizationId,
    `GET /auth/v1/oauth/authorize: expected a redirect to the consent page with an authorization_id, got ${start.status}`);
  return { authorizationId, verifier, state };
}

/** Reads the code out of an approval's redirect address and checks it goes back to the app. */
export function codeFromRedirect(redirectUrl, { redirectUri, state }) {
  const back = new URL(redirectUrl);
  must(`${back.origin}${back.pathname}` === redirectUri, "the approval did not send the browser back to the app's redirect address");
  must(back.searchParams.get("state") === state, "the approval's redirect lost the state");
  const code = back.searchParams.get("code");
  must(code, "the approval's redirect has no code");
  return code;
}

/** Exchanges an authorization code at the token endpoint: `{ accessToken, refreshToken }`. */
export async function exchangeCode({ apiUrl, publishable, clientId, redirectUri, code, verifier }) {
  const exchanged = await fetch(`${apiUrl}/auth/v1/oauth/token`, {
    method: "POST",
    headers: { apikey: publishable, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier }),
  });
  const body = await exchanged.json().catch(() => ({}));
  must(exchanged.ok && typeof body.access_token === "string",
    `POST /auth/v1/oauth/token (code exchange): ${exchanged.status} ${shortText(body.error_code ?? body.error ?? "")}`);
  must(typeof body.refresh_token === "string" && body.refresh_token.length > 0, "the code exchange gave no refresh token");
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

/**
 * A real OAuth token pair for the person signed in on `approver` (a supabase-js client holding
 * that person's password session) and app `clientId`: start an authorization request, approve it
 * as the person (the consent screen's own calls), exchange the code. The access token must carry
 * the app's `client_id` and the person's id (`expectedUserId`).
 */
export async function headlessAppTokens({ apiUrl, publishable, approver, clientId, redirectUri, expectedUserId, label = "the person" }) {
  const { authorizationId, verifier, state } = await startAuthorization({ apiUrl, publishable, clientId, redirectUri });
  const details = await approver.auth.oauth.getAuthorizationDetails(authorizationId);
  must(!details.error, `getAuthorizationDetails as ${label}: ${shortText(details.error?.message)}`);
  const approved = await approver.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
  must(!approved.error && approved.data?.redirect_url, `approveAuthorization as ${label}: ${shortText(approved.error?.message ?? "no redirect_url")}`);
  const code = codeFromRedirect(approved.data.redirect_url, { redirectUri, state });
  const tokens = await exchangeCode({ apiUrl, publishable, clientId, redirectUri, code, verifier });
  const claims = claimsOf(tokens.accessToken);
  must(claims.client_id === clientId && claims.sub === expectedUserId && claims.role === "authenticated",
    "the OAuth access token does not carry this app's client_id and this user's id");
  return tokens;
}

/** One refresh at the OAuth token endpoint: `{ ok, status, error, accessToken?, refreshToken? }`. */
export async function refreshAppTokens({ apiUrl, publishable, clientId, refreshToken }) {
  const response = await fetch(`${apiUrl}/auth/v1/oauth/token`, {
    method: "POST",
    headers: { apikey: publishable, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
  });
  const json = await response.json().catch(() => ({}));
  const ok = response.ok && typeof json.access_token === "string" && typeof json.refresh_token === "string";
  return {
    ok,
    status: response.status,
    error: json.error_code ?? json.error ?? "",
    accessToken: ok ? json.access_token : undefined,
    refreshToken: ok ? json.refresh_token : undefined,
  };
}
