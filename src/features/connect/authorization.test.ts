import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  email: "person@example.test" as string | null,
  details: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: () => mocks.configured }));
vi.mock("@/lib/supabase/user", () => ({ getUserEmail: async () => mocks.email }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { lookUpAuthorization } from "./authorization";

const id = "3f1c6a2e9b7d4c1a8e2f0a1b2c3d4e5f";
const details = (overrides: Record<string, unknown> = {}) => ({
  authorization_id: id,
  redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  client: { id: "c0ffee00-0000-4000-8000-000000000001", name: "Claude", uri: "https://claude.ai", logo_uri: "" },
  user: { id: "ac000000-0000-4000-8000-000000000009", email: "details@example.test" },
  scope: "openid email profile",
  ...overrides,
});

beforeEach(() => {
  mocks.configured = true;
  mocks.email = "person@example.test";
  mocks.details.mockReset().mockResolvedValue({ data: details(), error: null });
  mocks.createClient.mockReset().mockImplementation(async () => ({ auth: { oauth: { getAuthorizationDetails: mocks.details } } }));
});

describe("lookUpAuthorization", () => {
  it("shows the consent screen with the client's name, the redirect host and the signed-in email", async () => {
    expect(await lookUpAuthorization(id)).toEqual({ kind: "consent", id, name: "Claude", host: "claude.ai", email: "person@example.test" });
    expect(mocks.details).toHaveBeenCalledWith(id);
  });

  it("sanitises the name the app gives itself and keeps the port in the host", async () => {
    mocks.details.mockResolvedValue({
      data: details({ client: { name: "  Cla‮ude‬<b>x</b>\n " }, redirect_uri: "http://localhost:6274/oauth/callback" }),
      error: null,
    });
    expect(await lookUpAuthorization(id)).toMatchObject({ kind: "consent", name: "Claude<b>x</b>", host: "localhost:6274" });
  });

  it("falls back to the email in the details when the session email cannot be read", async () => {
    mocks.email = null;
    expect(await lookUpAuthorization(id)).toMatchObject({ kind: "consent", email: "details@example.test" });
  });

  it.each([undefined, null, ""])("a missing id (%s) is expired without calling Supabase", async (value) => {
    expect(await lookUpAuthorization(value)).toEqual({ kind: "expired" });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.details).not.toHaveBeenCalled();
  });

  it.each(["notreal", "../../evil", `${id}/consent`, "https://evil.example", "a".repeat(129), ["abc12345"], 12345678])(
    "a malformed id (%s) is expired and never reaches Supabase",
    async (value) => {
      expect(await lookUpAuthorization(value)).toEqual({ kind: "expired" });
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.details).not.toHaveBeenCalled();
    },
  );

  it("is expired without Supabase configured (preview mode)", async () => {
    mocks.configured = false;
    expect(await lookUpAuthorization(id)).toEqual({ kind: "expired" });
    expect(mocks.details).not.toHaveBeenCalled();
  });

  it("is expired when Supabase reports an error", async () => {
    mocks.details.mockResolvedValue({ data: null, error: { name: "AuthApiError", status: 500, code: "unexpected_failure" } });
    expect(await lookUpAuthorization(id)).toEqual({ kind: "expired" });
  });

  it("is expired for an id that was already used or decided (Supabase no longer knows it)", async () => {
    // What the live check saw on reopening a decided id: an error response, no data.
    mocks.details.mockResolvedValue({ data: null, error: { name: "AuthApiError", status: 404, code: "oauth_authorization_not_found" } });
    expect(await lookUpAuthorization(id)).toEqual({ kind: "expired" });
  });

  it("is expired when Supabase answers with no data and no error", async () => {
    mocks.details.mockResolvedValue({ data: null, error: null });
    expect(await lookUpAuthorization(id)).toEqual({ kind: "expired" });
  });

  it("redirects an already-allowed app to the address Supabase returns", async () => {
    const url = "https://claude.ai/api/mcp/auth_callback?code=synthetic&state=s";
    mocks.details.mockResolvedValue({ data: { redirect_url: url }, error: null });
    expect(await lookUpAuthorization(id)).toEqual({ kind: "redirect", url });
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "not a url", ""])("never redirects to an unusable address (%s): expired instead", async (url) => {
    mocks.details.mockResolvedValue({ data: { redirect_url: url }, error: null });
    expect(await lookUpAuthorization(id)).toEqual({ kind: "expired" });
  });

  it.each(["not a url", "com.example.app:/callback", "javascript:alert(1)", "", undefined])(
    "is expired when the redirect URI cannot be parsed or has no host (%s)",
    async (redirect_uri) => {
      mocks.details.mockResolvedValue({ data: details({ redirect_uri }), error: null });
      expect(await lookUpAuthorization(id)).toEqual({ kind: "expired" });
    },
  );

  it("is expired, not a crash, when the lookup throws", async () => {
    mocks.details.mockRejectedValue(new Error("network down"));
    expect(await lookUpAuthorization(id)).toEqual({ kind: "expired" });
    mocks.createClient.mockRejectedValue(new Error("no cookies"));
    expect(await lookUpAuthorization(id)).toEqual({ kind: "expired" });
  });
});
