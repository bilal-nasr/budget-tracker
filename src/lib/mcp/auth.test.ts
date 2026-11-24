import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";

// Only the Supabase factory is synthetic, so getClaims' answer is controllable.
const sdk = vi.hoisted(() => ({
  getClaims: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  // The real error classes and predicates; only the client is synthetic.
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: (...args: unknown[]) => {
    sdk.createClient(...args);
    return { auth: { getClaims: sdk.getClaims } };
  },
}));
vi.mock("next/headers", () => ({
  cookies: () => {
    throw new Error("token verification must never touch cookies");
  },
}));
// The allowlist lookup is its own module (clients.test.ts); here only its answer matters.
const allowlist = vi.hoisted(() => ({ isAllowedClient: vi.fn() }));
vi.mock("./clients", () => ({ isAllowedClient: allowlist.isAllowedClient }));
import { AuthApiError, AuthInvalidJwtError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { authInfoUserId, bearerVerifier, verifyAccessToken } from "./auth";

const USER = "ac000000-0000-4000-8000-000000000001";
const exp = Math.floor(Date.now() / 1000) + 3600;
const SID = "5e550000-0000-4000-8000-0000000000a1";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-public-key");
  sdk.getClaims.mockReset();
  sdk.createClient.mockReset();
  allowlist.isAllowedClient.mockReset();
  allowlist.isAllowedClient.mockImplementation(async (clientId: string) => clientId === "client-123");
});
afterEach(() => vi.unstubAllEnvs());

const claims = (extra: Record<string, unknown> = {}) => ({
  data: { claims: { sub: USER, role: "authenticated", exp, session_id: SID, ...extra }, header: {}, signature: new Uint8Array() },
  error: null,
});

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

test("valid claims map to user id, client id and expiry", async () => {
  sdk.getClaims.mockResolvedValue(claims({ client_id: "client-123", scope: "openid email" }));
  await expect(verifyAccessToken("tok")).resolves.toEqual({
    userId: USER,
    clientId: "client-123",
    sessionId: SID,
    expiresAt: exp,
    scopes: ["openid", "email"],
  });
  expect(sdk.getClaims).toHaveBeenCalledWith("tok");
});

test("the verifying client keeps no session, is reused, and follows a changed project address", async () => {
  sdk.getClaims.mockResolvedValue(claims());
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "another-public-key");
  await verifyAccessToken("tok");
  await verifyAccessToken("tok");
  expect(sdk.createClient).toHaveBeenCalledTimes(1);
  const [url, key, options] = sdk.createClient.mock.calls[0] as [string, string, { auth: Record<string, unknown> }];
  expect(url).toBe("https://synthetic.supabase.test");
  expect(key).toBe("another-public-key");
  expect(options.auth).toMatchObject({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
});

test("a session token without client_id is accepted with clientId 'session'", async () => {
  sdk.getClaims.mockResolvedValue(claims());
  await expect(verifyAccessToken("tok")).resolves.toMatchObject({ userId: USER, clientId: "session", sessionId: SID, scopes: [] });
});

test.each([
  ["missing", undefined],
  ["malformed", "not-a-uuid"],
])("a session token (no client_id) with a %s session_id is still accepted, with sessionId null", async (_name, value) => {
  sdk.getClaims.mockResolvedValue(claims({ session_id: value }));
  await expect(verifyAccessToken("tok")).resolves.toMatchObject({ clientId: "session", sessionId: null });
});

describe("rejects", () => {
  const cases: [string, () => void][] = [
    ["no sub", () => sdk.getClaims.mockResolvedValue(claims({ sub: undefined }))],
    ["sub that is not a user id", () => sdk.getClaims.mockResolvedValue(claims({ sub: "service" }))],
    ["role anon", () => sdk.getClaims.mockResolvedValue(claims({ role: "anon" }))],
    ["role service_role", () => sdk.getClaims.mockResolvedValue(claims({ role: "service_role" }))],
    ["getClaims error", () => sdk.getClaims.mockResolvedValue({ data: null, error: new Error("invalid JWT") })],
    ["bad signature", () => sdk.getClaims.mockResolvedValue({ data: null, error: new AuthInvalidJwtError("Invalid JWT signature") })],
    ["Auth says 403 (revoked session)", () => sdk.getClaims.mockResolvedValue({ data: null, error: new AuthApiError("Session not found", 403, "session_not_found") })],
    // getClaims decodes the token before any network call; a malformed one can throw out of it.
    ["getClaims throws SyntaxError (header is not JSON)", () => sdk.getClaims.mockRejectedValue(new SyntaxError("Unexpected token"))],
    ["getClaims throws 'Invalid UTF-8 sequence'", () => sdk.getClaims.mockRejectedValue(new Error("Invalid UTF-8 sequence"))],
    ["getClaims throws 'Invalid alg claim'", () => sdk.getClaims.mockRejectedValue(new Error("Invalid alg claim"))],
    ["getClaims throws a WebCrypto DOMException", () => sdk.getClaims.mockRejectedValue(new DOMException("Invalid keyData", "DataError"))],
    ["getClaims throws a TypeError on a null header", () => sdk.getClaims.mockRejectedValue(new TypeError("Cannot read properties of null (reading 'alg')"))],
    ["exp missing", () => sdk.getClaims.mockResolvedValue(claims({ exp: undefined }))],
    ["exp not a number", () => sdk.getClaims.mockResolvedValue(claims({ exp: "soon" }))],
    // "session" is how an ordinary session token is reported; a claim can never pose as one.
    ["client_id 'session'", () => sdk.getClaims.mockResolvedValue(claims({ client_id: "session" }))],
    ["client_id that is not a string", () => sdk.getClaims.mockResolvedValue(claims({ client_id: 7 }))],
    ["empty client_id", () => sdk.getClaims.mockResolvedValue(claims({ client_id: "" }))],
    // An app token is only as good as its session (the /mcp cache and the database guard key on it).
    ["app token without session_id", () => sdk.getClaims.mockResolvedValue(claims({ client_id: "client-123", session_id: undefined }))],
    ["app token with an empty session_id", () => sdk.getClaims.mockResolvedValue(claims({ client_id: "client-123", session_id: "" }))],
    ["app token with a malformed session_id", () => sdk.getClaims.mockResolvedValue(claims({ client_id: "client-123", session_id: "not-a-uuid" }))],
    ["app token with an upper-case session_id", () => sdk.getClaims.mockResolvedValue(claims({ client_id: "client-123", session_id: SID.toUpperCase() }))],
    ["app token with a non-string session_id", () => sdk.getClaims.mockResolvedValue(claims({ client_id: "client-123", session_id: 7 }))],
  ];
  test.each(cases)("%s", async (_name, arrange) => {
    arrange();
    const error = await rejection(verifyAccessToken("tok"));
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe(OAuthErrorCode.InvalidToken);
  });

  test("an empty token without asking Supabase", async () => {
    const error = await rejection(verifyAccessToken(""));
    expect((error as OAuthError).code).toBe(OAuthErrorCode.InvalidToken);
    expect(sdk.getClaims).not.toHaveBeenCalled();
  });
});

describe("a Supabase outage is not a bad token: a plain Error (the SDK answers 500), never invalid_token", () => {
  const cases: [string, () => void][] = [
    ["network failure (retryable, status 0)", () => sdk.getClaims.mockResolvedValue({ data: null, error: new AuthRetryableFetchError("fetch failed", 0) })],
    ["503 from Auth (retryable)", () => sdk.getClaims.mockResolvedValue({ data: null, error: new AuthRetryableFetchError("Service Unavailable", 503) })],
    ["500 from Auth", () => sdk.getClaims.mockResolvedValue({ data: null, error: new AuthApiError("Internal error", 500, "unexpected_failure") })],
    ["getClaims throws a failed fetch (undici)", () => sdk.getClaims.mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: new Error("connect ECONNREFUSED") }))],
    ["getClaims throws a timeout", () => sdk.getClaims.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"))],
    ["getClaims throws an abort", () => sdk.getClaims.mockRejectedValue(new DOMException("This operation was aborted", "AbortError"))],
  ];
  test.each(cases)("%s", async (_name, arrange) => {
    arrange();
    const error = await rejection(verifyAccessToken("tok"));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(OAuthError);
    // Nothing from Supabase's own message is carried along.
    expect((error as Error).message).not.toMatch(/fetch failed|Service Unavailable|Internal error/);
  });
});

describe("bearerVerifier (the gate /mcp uses): approved apps only", () => {
  test("a registered app's token returns SDK AuthInfo carrying the verified user id", async () => {
    sdk.getClaims.mockResolvedValue(claims({ client_id: "client-123" }));
    const info = await bearerVerifier.verifyAccessToken("tok");
    expect(info).toMatchObject({ token: "tok", clientId: "client-123", expiresAt: exp, scopes: [] });
    expect(authInfoUserId(info)).toBe(USER);
    // Asked with the caller's own token, after the token itself checked out.
    expect(allowlist.isAllowedClient).toHaveBeenCalledWith("client-123", SID, "tok");
  });

  test("a valid token from an app that is not registered is invalid_token", async () => {
    sdk.getClaims.mockResolvedValue(claims({ client_id: "client-unknown" }));
    const error = await rejection(bearerVerifier.verifyAccessToken("tok"));
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe(OAuthErrorCode.InvalidToken);
    expect(allowlist.isAllowedClient).toHaveBeenCalledWith("client-unknown", SID, "tok");
  });

  test("an allowlist lookup that cannot be answered (outage) is a plain Error (the SDK answers 500), never invalid_token or acceptance", async () => {
    sdk.getClaims.mockResolvedValue(claims({ client_id: "client-123" }));
    allowlist.isAllowedClient.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:54321"));
    const error = await rejection(bearerVerifier.verifyAccessToken("tok"));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(OAuthError);
    expect((error as Error).message).not.toMatch(/ECONNREFUSED|54321/);
  });

  test("a bad token is refused before the allowlist is asked", async () => {
    sdk.getClaims.mockResolvedValue({ data: null, error: new AuthInvalidJwtError("Invalid JWT signature") });
    await rejection(bearerVerifier.verifyAccessToken("tok"));
    expect(allowlist.isAllowedClient).not.toHaveBeenCalled();
  });

  test.each([
    ["unset", undefined],
    ["empty", ""],
    ["'true'", "true"],
    ["'0'", "0"],
  ])("an ordinary session token is invalid_token when MCP_ALLOW_SESSION_TOKENS is %s", async (_name, value) => {
    if (value !== undefined) vi.stubEnv("MCP_ALLOW_SESSION_TOKENS", value);
    sdk.getClaims.mockResolvedValue(claims());
    const error = await rejection(bearerVerifier.verifyAccessToken("tok"));
    expect((error as OAuthError).code).toBe(OAuthErrorCode.InvalidToken);
    expect(allowlist.isAllowedClient).not.toHaveBeenCalled();
  });

  test("an ordinary session token is accepted with MCP_ALLOW_SESSION_TOKENS=1 (local testing)", async () => {
    vi.stubEnv("MCP_ALLOW_SESSION_TOKENS", "1");
    sdk.getClaims.mockResolvedValue(claims());
    const info = await bearerVerifier.verifyAccessToken("tok");
    expect(info).toMatchObject({ token: "tok", clientId: "session" });
    expect(authInfoUserId(info)).toBe(USER);
    expect(allowlist.isAllowedClient).not.toHaveBeenCalled();
  });

  test("MCP_ALLOW_SESSION_TOKENS=1 does not let an unregistered app in", async () => {
    vi.stubEnv("MCP_ALLOW_SESSION_TOKENS", "1");
    sdk.getClaims.mockResolvedValue(claims({ client_id: "client-unknown" }));
    const error = await rejection(bearerVerifier.verifyAccessToken("tok"));
    expect((error as OAuthError).code).toBe(OAuthErrorCode.InvalidToken);
  });
});

test("authInfoUserId is null without a verified user id", () => {
  expect(authInfoUserId(undefined)).toBeNull();
  expect(authInfoUserId({ token: "t", clientId: "c", scopes: [] })).toBeNull();
  expect(authInfoUserId({ token: "t", clientId: "c", scopes: [], extra: { userId: 42 } })).toBeNull();
});
