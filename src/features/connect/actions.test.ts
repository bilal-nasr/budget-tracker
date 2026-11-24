import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  userId: "ac000000-0000-4000-8000-000000000009" as string | null,
  approve: vi.fn(),
  deny: vi.fn(),
  forget: vi.fn(),
  revoke: vi.fn(),
  revalidate: vi.fn(),
  connector: undefined as object | undefined,
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: () => mocks.configured }));
vi.mock("@/lib/supabase/user", () => ({ getUserId: async () => mocks.userId }));
vi.mock("@/lib/supabase/request-context", () => ({ connectorContext: () => mocks.connector }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { oauth: { approveAuthorization: mocks.approve, denyAuthorization: mocks.deny, revokeGrant: mocks.revoke } },
  }),
}));
vi.mock("./pending-authorization", async (original) => ({
  ...(await original<typeof import("./pending-authorization")>()),
  forgetPendingAuthorization: mocks.forget,
}));
import { decideAuthorization, revokeConnectedApp } from "./actions";

const id = "3f1c6a2e-9b7d-4c1a-8e2f-0a1b2c3d4e5f";
const approved = "https://claude.ai/api/mcp/auth_callback?code=synthetic-code&state=synthetic-state";
const denied = "https://claude.ai/api/mcp/auth_callback?error=access_denied&state=synthetic-state";

beforeEach(() => {
  mocks.configured = true;
  mocks.userId = "ac000000-0000-4000-8000-000000000009";
  mocks.approve.mockReset().mockResolvedValue({ data: { redirect_url: approved }, error: null });
  mocks.deny.mockReset().mockResolvedValue({ data: { redirect_url: denied }, error: null });
  mocks.forget.mockReset().mockResolvedValue(undefined);
  mocks.revoke.mockReset().mockResolvedValue({ data: {}, error: null });
  mocks.revalidate.mockReset();
  mocks.connector = undefined;
});

describe("decideAuthorization", () => {
  it("approves and returns the redirect URL Supabase gives, never asking the browser to redirect itself", async () => {
    expect(await decideAuthorization(id, "approve")).toEqual({ ok: true, redirectUrl: approved });
    expect(mocks.approve).toHaveBeenCalledWith(id, { skipBrowserRedirect: true });
    expect(mocks.deny).not.toHaveBeenCalled();
    expect(mocks.forget).toHaveBeenCalledTimes(1);
  });

  it("denies and returns Supabase's redirect URL likewise", async () => {
    expect(await decideAuthorization(id, "deny")).toEqual({ ok: true, redirectUrl: denied });
    expect(mocks.deny).toHaveBeenCalledWith(id, { skipBrowserRedirect: true });
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it.each(["../x", "short", `${id}/consent`, "", 7, null])("refuses a malformed id (%s) without calling Supabase", async (value) => {
    expect(await decideAuthorization(value as never, "approve")).toEqual({ ok: false, error: "invalid" });
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it.each(["allow", "", undefined])("refuses an unknown decision (%s) without calling Supabase", async (value) => {
    expect(await decideAuthorization(id, value as never)).toEqual({ ok: false, error: "invalid" });
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.deny).not.toHaveBeenCalled();
  });

  it("reports an expired authorization when Supabase refuses it", async () => {
    mocks.approve.mockResolvedValue({ data: null, error: { code: "oauth_authorization_not_found", status: 404 } });
    expect(await decideAuthorization(id, "approve")).toEqual({ ok: false, error: "expired" });
  });

  it("is a failure when nobody is signed in, without calling Supabase", async () => {
    mocks.userId = null;
    expect(await decideAuthorization(id, "approve")).toEqual({ ok: false, error: "failed" });
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("is a failure in preview mode", async () => {
    mocks.configured = false;
    expect(await decideAuthorization(id, "deny")).toEqual({ ok: false, error: "failed" });
    expect(mocks.deny).not.toHaveBeenCalled();
  });

  it.each(["", "not a url", "javascript:alert(1)", "data:text/html,x"])("never hands the browser an unusable redirect (%s)", async (redirect) => {
    mocks.approve.mockResolvedValue({ data: { redirect_url: redirect }, error: null });
    expect(await decideAuthorization(id, "approve")).toEqual({ ok: false, error: "failed" });
  });

  it("is a failure, not a crash, when the request throws", async () => {
    mocks.approve.mockRejectedValue(new Error("network down"));
    expect(await decideAuthorization(id, "approve")).toEqual({ ok: false, error: "failed" });
  });
});

describe("revokeConnectedApp", () => {
  // Local Supabase OAuth client ids are UUIDs; the pattern also allows other URL-safe ids.
  const clientId = "7a0c2f4e-1b3d-4e5f-8a9b-0c1d2e3f4a5b";

  it("removes the signed-in person's grant for that app and refreshes Settings", async () => {
    expect(await revokeConnectedApp(clientId)).toEqual({ ok: true });
    expect(mocks.revoke).toHaveBeenCalledWith({ clientId });
    expect(mocks.revalidate).toHaveBeenCalledWith("/[locale]/settings", "page");
  });

  it.each(["", "../x", `${clientId}&client_id=other`, "a b", "x".repeat(129), "id/with/slash", "naïve", 7, null, undefined])(
    "refuses a malformed client id (%s) without calling Supabase",
    async (value) => {
      expect(await revokeConnectedApp(value as never)).toEqual({ ok: false, error: "invalid" });
      expect(mocks.revoke).not.toHaveBeenCalled();
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it("accepts the longest allowed id", async () => {
    expect(await revokeConnectedApp("a".repeat(128))).toEqual({ ok: true });
  });

  it("is a failure when Supabase refuses, without refreshing", async () => {
    mocks.revoke.mockResolvedValue({ data: null, error: { name: "AuthApiError", status: 404 } });
    expect(await revokeConnectedApp(clientId)).toEqual({ ok: false, error: "failed" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("is a failure, not a crash, when the request throws", async () => {
    mocks.revoke.mockRejectedValue(new Error("network down"));
    expect(await revokeConnectedApp(clientId)).toEqual({ ok: false, error: "failed" });
  });

  // What the local Supabase Auth answers when there is no grant for that app (measured in test-mcp (f)):
  // AuthApiError, status 404, code "oauth_consent_not_found".
  it("treats an app that is already removed as removed (404 oauth_consent_not_found) and refreshes Settings", async () => {
    mocks.revoke.mockResolvedValue({ data: null, error: { name: "AuthApiError", status: 404, code: "oauth_consent_not_found", message: "anything" } });
    expect(await revokeConnectedApp(clientId)).toEqual({ ok: true });
    expect(mocks.revalidate).toHaveBeenCalledWith("/[locale]/settings", "page");
  });

  it.each([
    [{ status: 404, code: "user_not_found" }],
    [{ status: 404 }],
    [{ status: 400, code: "oauth_consent_not_found" }],
    [{ status: 500, code: "oauth_consent_not_found" }],
    [{ code: "oauth_consent_not_found" }],
    [{ status: 404, code: "other", message: "No active grant found for this client" }],
  ])("is a failure for any other error (%o), whatever its message says", async (error) => {
    mocks.revoke.mockResolvedValue({ data: null, error: { name: "AuthApiError", ...error } });
    expect(await revokeConnectedApp(clientId)).toEqual({ ok: false, error: "failed" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("is a failure when nobody is signed in, without calling Supabase", async () => {
    mocks.userId = null;
    expect(await revokeConnectedApp(clientId)).toEqual({ ok: false, error: "failed" });
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("is a failure in preview mode", async () => {
    mocks.configured = false;
    expect(await revokeConnectedApp(clientId)).toEqual({ ok: false, error: "failed" });
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("is a failure inside a connector request: a connected app cannot remove grants", async () => {
    mocks.connector = { accessToken: "synthetic", userId: "ac000000-0000-4000-8000-000000000009" };
    expect(await revokeConnectedApp(clientId)).toEqual({ ok: false, error: "failed" });
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
});
