// The installed @supabase/auth-js (2.118.0, dist/module/lib/types.d.ts) declares, on
// `supabase.auth.oauth` (AuthOAuthServerApi):
//
//   listGrants(): Promise<AuthOAuthGrantsResponse>;            // RequestResult<OAuthGrant[]>
//   revokeGrant(options: { clientId: string }): Promise<AuthOAuthRevokeGrantResponse>; // RequestResult<{}>
//
//   type OAuthGrant = { client: OAuthAuthorizationClient; scopes: string[]; granted_at: string };
//   type OAuthAuthorizationClient = { id: string; name: string; uri: string; logo_uri: string };
//
// Both use the client's own session (GET / DELETE `${url}/user/oauth/grants`, the latter with
// `?client_id=`), so they only ever see or remove the signed-in person's grants. With no
// session they return `{ data: null, error: AuthSessionMissingError }`.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  connector: undefined as object | undefined,
  listGrants: vi.fn(),
  order: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  headers: new Map<string, string>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: () => mocks.configured }));
vi.mock("@/lib/supabase/request-context", () => ({ connectorContext: () => mocks.connector }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (name: string) => mocks.headers.get(name.toLowerCase()) ?? null }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { oauth: { listGrants: mocks.listGrants } }, from: mocks.from }),
}));
import { getConnectedApps, getConnectorSetup } from "./grants";

const grant = (id: unknown, name: unknown, granted_at: unknown = "2026-11-20T10:00:00Z") => ({
  client: { id, name, uri: "https://example.test", logo_uri: "" },
  scopes: ["openid", "email"],
  granted_at,
});

beforeEach(() => {
  mocks.configured = true;
  mocks.connector = undefined;
  mocks.listGrants.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.order.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.select.mockReset().mockReturnValue({ order: mocks.order });
  mocks.from.mockReset().mockReturnValue({ select: mocks.select });
  mocks.headers = new Map([["host", "localhost:3100"]]);
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
});

describe("getConnectedApps", () => {
  it("maps each grant to a connected app with its name as plain text", async () => {
    mocks.listGrants.mockResolvedValue({
      data: [grant("3f1c6a2e-9b7d-4c1a-8e2f-0a1b2c3d4e5f", "  Claude‮  "), grant("client_2", "<b>Other</b>​", "2026-11-21T08:30:00.000Z")],
      error: null,
    });
    expect(await getConnectedApps()).toEqual([
      { clientId: "3f1c6a2e-9b7d-4c1a-8e2f-0a1b2c3d4e5f", name: "Claude", grantedAt: "2026-11-20T10:00:00Z" },
      // Never HTML: angle brackets stay literal text for React to escape.
      { clientId: "client_2", name: "<b>Other</b>", grantedAt: "2026-11-21T08:30:00.000Z" },
    ]);
  });

  it("gives null for a missing or unreadable granted date, and an empty name for a missing one", async () => {
    mocks.listGrants.mockResolvedValue({ data: [grant("a1", undefined, "not a date"), grant("a2", 7, null)], error: null });
    expect(await getConnectedApps()).toEqual([
      { clientId: "a1", name: "", grantedAt: null },
      { clientId: "a2", name: "", grantedAt: null },
    ]);
  });

  it("leaves out a grant whose client id could not be revoked", async () => {
    mocks.listGrants.mockResolvedValue({
      data: [grant("good-id", "Good"), grant("../x", "Path"), grant("", "Empty"), grant(42, "Number"), { scopes: [] }, null],
      error: null,
    });
    expect(await getConnectedApps()).toEqual([{ clientId: "good-id", name: "Good", grantedAt: "2026-11-20T10:00:00Z" }]);
  });

  it("is an empty list when nothing is connected", async () => {
    expect(await getConnectedApps()).toEqual([]);
  });

  it("is null when the list could not be loaded", async () => {
    mocks.listGrants.mockResolvedValue({ data: null, error: { name: "AuthApiError", status: 500 } });
    expect(await getConnectedApps()).toBeNull();
  });

  it("is null when the answer is not a list", async () => {
    mocks.listGrants.mockResolvedValue({ data: { grants: [] }, error: null });
    expect(await getConnectedApps()).toBeNull();
  });

  it("is null, not a crash, when the request throws", async () => {
    mocks.listGrants.mockRejectedValue(new Error("network down"));
    expect(await getConnectedApps()).toBeNull();
  });

  it("is null in preview mode without calling Supabase", async () => {
    mocks.configured = false;
    expect(await getConnectedApps()).toBeNull();
    expect(mocks.listGrants).not.toHaveBeenCalled();
  });

  it("is null inside a connector request: only the browser session lists grants", async () => {
    mocks.connector = { accessToken: "synthetic", userId: "ac000000-0000-4000-8000-000000000009" };
    expect(await getConnectedApps()).toBeNull();
    expect(mocks.listGrants).not.toHaveBeenCalled();
  });
});

describe("getConnectorSetup", () => {
  it("gives the connector address and the registered apps, oldest first, names as plain text", async () => {
    mocks.order.mockResolvedValue({ data: [{ client_id: "c-1", name: "Claude⁦" }, { client_id: "c-2", name: " Claude Desktop " }], error: null });
    expect(await getConnectorSetup()).toEqual({
      url: "http://localhost:3100/mcp",
      clients: [{ clientId: "c-1", name: "Claude" }, { clientId: "c-2", name: "Claude Desktop" }],
    });
    expect(mocks.from).toHaveBeenCalledWith("connector_clients");
    expect(mocks.select).toHaveBeenCalledWith("client_id, name");
    expect(mocks.order).toHaveBeenCalledWith("created_at", { ascending: true });
  });

  it("uses the configured site address and base path over the request's own host", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://budget.example.test/");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/budget");
    mocks.headers = new Map([["host", "internal:3000"]]);
    expect((await getConnectorSetup()).url).toBe("https://budget.example.test/budget/mcp");
  });

  it("follows the forwarded protocol for the request host when no site address is configured", async () => {
    mocks.headers = new Map([["host", "budget.lan"], ["x-forwarded-proto", "https"]]);
    expect((await getConnectorSetup()).url).toBe("https://budget.lan/mcp");
  });

  it.each([["evil/path"], ["a b"], [""], ["user@host"]])("falls back to localhost for an unusable host header (%s)", async (host) => {
    mocks.headers = new Map([["host", host], ["x-forwarded-proto", "javascript"]]);
    expect((await getConnectorSetup()).url).toBe("http://localhost:3000/mcp");
  });

  it("keeps the address and lists no apps when the table read fails", async () => {
    mocks.order.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    expect(await getConnectorSetup()).toEqual({ url: "http://localhost:3100/mcp", clients: [] });
  });

  it("keeps the address and lists no apps when the read throws", async () => {
    mocks.order.mockRejectedValue(new Error("network down"));
    expect(await getConnectorSetup()).toEqual({ url: "http://localhost:3100/mcp", clients: [] });
  });

  it("leaves out rows without a usable client id", async () => {
    mocks.order.mockResolvedValue({ data: [{ client_id: null, name: "x" }, { client_id: "ok", name: null }], error: null });
    expect((await getConnectorSetup()).clients).toEqual([{ clientId: "ok", name: "" }]);
  });

  it("lists no apps in preview mode without calling Supabase", async () => {
    mocks.configured = false;
    expect(await getConnectorSetup()).toEqual({ url: "http://localhost:3100/mcp", clients: [] });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
