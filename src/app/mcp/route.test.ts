import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const USER = "ac000000-0000-4000-8000-000000000001";
const GOOD = "good-token";

const UNLISTED = "unlisted-app-token";
const SESSION = "session-token";

// Synthetic Supabase: getClaims accepts GOOD (registered app "client-1"), UNLISTED (app
// "client-2", not registered) and SESSION (no client_id); connector_clients lists "client-1".
// The profile query records who it was asked for.
const sdk = vi.hoisted(() => ({
  clients: [] as { url: string; key: string; options: { global?: { headers?: Record<string, string> } } }[],
  getClaims: async (token: string) => {
    const base = { sub: "ac000000-0000-4000-8000-000000000001", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 };
    // App tokens carry their session's id (required for an app token).
    const session_id = "5e550000-0000-4000-8000-0000000000c1";
    if (token === "good-token") return { data: { claims: { ...base, client_id: "client-1", session_id } }, error: null };
    if (token === "unlisted-app-token") return { data: { claims: { ...base, client_id: "client-2", session_id } }, error: null };
    if (token === "session-token") return { data: { claims: base }, error: null };
    return { data: null, error: new Error("invalid JWT") };
  },
  registered: ["client-1"],
  clientLookupOutage: false,
  clientLookups: [] as unknown[],
  profileLookups: [] as [string, unknown][],
  profileRow: null as Record<string, unknown> | null,
  profileThrows: null as Error | null,
  cookieCalls: 0,
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => {
    sdk.cookieCalls++;
    throw new Error("a connector request must never read cookies");
  },
}));
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  // The real error classes and predicates; only the client is synthetic.
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: (url: string, key: string, options: { global?: { headers?: Record<string, string> } }) => {
    sdk.clients.push({ url, key, options });
    return {
      auth: { getClaims: (token: string) => sdk.getClaims(token) },
      from: (table: string) => ({
        select: () => ({
          eq: (column: string, value: unknown) => {
            if (table === "connector_clients") {
              sdk.clientLookups.push(value);
              const chain = {
                abortSignal: () => chain,
                maybeSingle: async () =>
                  sdk.clientLookupOutage
                    ? { data: null, error: { code: "", message: "TypeError: fetch failed" }, status: 0 }
                    : { data: sdk.registered.includes(String(value)) ? { client_id: value } : null, error: null, status: 200 },
              };
              return chain;
            }
            sdk.profileLookups.push([column, value]);
            return {
              maybeSingle: async () => {
                if (sdk.profileThrows) throw sdk.profileThrows;
                return { data: sdk.profileRow, error: null };
              },
            };
          },
        }),
      }),
    };
  },
}));
import { clearAllowedClientCache } from "@/lib/mcp/clients";
import { ToolError } from "@/lib/mcp/tool";
import { DELETE, GET, POST } from "./route";

const ENDPOINT = "http://localhost:3000/mcp";
const handlers: Record<string, (request: Request) => Promise<Response>> = { GET, POST, DELETE };
const viaRoute = async (url: string | URL, init?: RequestInit) => {
  const request = new Request(url, init);
  const handler = handlers[request.method];
  return handler ? handler(request) : new Response(null, { status: 405 });
};

async function connect(token: string) {
  const client = new Client({ name: "route-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT), { fetch: viaRoute, authProvider: { token: async () => token } }));
  return client;
}

const rpc = (headers: Record<string, string> = {}) =>
  new Request(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-public-key");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://budget.example.com");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  sdk.clients = [];
  sdk.profileLookups = [];
  sdk.profileRow = null;
  sdk.profileThrows = null;
  sdk.cookieCalls = 0;
  sdk.registered = ["client-1"];
  sdk.clientLookupOutage = false;
  sdk.clientLookups = [];
  clearAllowedClientCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  expect(sdk.cookieCalls).toBe(0);
});

describe("the bearer gate", () => {
  test("no Authorization header → 401 with WWW-Authenticate containing resource_metadata=", async () => {
    const response = await POST(rpc());
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('resource_metadata="https://budget.example.com/.well-known/oauth-protected-resource/mcp"');
  });

  test("garbage bearer → 401", async () => {
    const response = await POST(rpc({ authorization: "Bearer not-a-real-token" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  test("Supabase Auth unreachable while checking the token → 500, not invalid_token", async () => {
    const { AuthRetryableFetchError } = await import("@supabase/supabase-js");
    const original = sdk.getClaims;
    sdk.getClaims = async () => ({ data: null, error: new AuthRetryableFetchError("fetch failed", 0) });
    try {
      const response = await POST(rpc({ authorization: `Bearer ${GOOD}` }));
      expect(response.status).toBe(500);
      expect(response.headers.get("www-authenticate") ?? "").not.toContain("invalid_token");
    } finally {
      sdk.getClaims = original;
    }
  });

  test("a malformed bearer (abc.def.ghi) through the real getClaims → 401 invalid_token, not 500", async () => {
    // The real auth-js client: it decodes the token locally and throws before any network call.
    const actual = await vi.importActual<typeof import("@supabase/supabase-js")>("@supabase/supabase-js");
    const real = actual.createClient("http://127.0.0.1:1", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false } });
    const original = sdk.getClaims;
    sdk.getClaims = ((token: string) => real.auth.getClaims(token)) as typeof sdk.getClaims;
    try {
      const response = await POST(rpc({ authorization: "Bearer abc.def.ghi" }));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
    } finally {
      sdk.getClaims = original;
    }
  });

  test("a valid token from an app that is not registered → 401 invalid_token, and no tool runs", async () => {
    const response = await POST(rpc({ authorization: `Bearer ${UNLISTED}` }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(sdk.clientLookups).toEqual(["client-2"]);
    expect(sdk.profileLookups).toEqual([]);
  });

  test("Supabase unreachable during the approved-app lookup → 500, not invalid_token, and no tool runs", async () => {
    sdk.clientLookupOutage = true;
    const response = await POST(rpc({ authorization: `Bearer ${GOOD}` }));
    expect(response.status).toBe(500);
    expect(response.headers.get("www-authenticate") ?? "").not.toContain("invalid_token");
    expect(sdk.profileLookups).toEqual([]);
    // Nothing cached: once Supabase answers again the same token goes through.
    sdk.clientLookupOutage = false;
    expect((await POST(rpc({ authorization: `Bearer ${GOOD}` }))).status).toBe(200);
  });

  test("a registered app's token → 200", async () => {
    const response = await POST(rpc({ authorization: `Bearer ${GOOD}` }));
    expect(response.status).toBe(200);
    expect(sdk.clientLookups).toEqual(["client-1"]);
  });

  test("an app removed from the list is refused once its cached approval runs out (60 s)", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-24T10:00:00Z"), toFake: ["Date"] });
    try {
      expect((await POST(rpc({ authorization: `Bearer ${GOOD}` }))).status).toBe(200);
      sdk.registered = [];
      vi.setSystemTime(new Date("2026-11-24T10:01:01Z"));
      const response = await POST(rpc({ authorization: `Bearer ${GOOD}` }));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
    } finally {
      vi.useRealTimers();
    }
  });

  test("an ordinary session token → 401 invalid_token unless MCP_ALLOW_SESSION_TOKENS=1", async () => {
    const refused = await POST(rpc({ authorization: `Bearer ${SESSION}` }));
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(sdk.clientLookups).toEqual([]);
  });

  test("an ordinary session token → 200 with MCP_ALLOW_SESSION_TOKENS=1 (local testing)", async () => {
    vi.stubEnv("MCP_ALLOW_SESSION_TOKENS", "1");
    const response = await POST(rpc({ authorization: `Bearer ${SESSION}` }));
    expect(response.status).toBe(200);
  });

  test("a non-bearer scheme → 401", async () => {
    const response = await POST(rpc({ authorization: `Basic ${GOOD}` }));
    expect(response.status).toBe(401);
  });

  test("valid Supabase session cookie but no bearer → 401", async () => {
    const response = await POST(rpc({ cookie: "sb-synthetic-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJnb29kLXRva2VuIn0" }));
    expect(response.status).toBe(401);
    expect(sdk.profileLookups).toEqual([]);
  });

  test("GET and DELETE are gated too", async () => {
    expect((await GET(new Request(ENDPOINT))).status).toBe(401);
    expect((await DELETE(new Request(ENDPOINT, { method: "DELETE" }))).status).toBe(401);
  });

  test("Supabase not configured → 503", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const response = await POST(rpc({ authorization: `Bearer ${GOOD}` }));
    expect(response.status).toBe(503);
  });
});

describe("with a valid bearer", () => {
  test("tools/list includes profile_get with readOnlyHint true", async () => {
    const client = await connect(GOOD);
    const { tools } = await client.listTools();
    const profile = tools.find((tool) => tool.name === "profile_get");
    expect(profile).toBeDefined();
    expect(profile?.annotations?.readOnlyHint).toBe(true);
    expect(profile?.description).toBeTruthy();
    await client.close();
  });

  test("profile_get runs as the token's user, with the token, and no cookies", async () => {
    sdk.profileRow = {
      locale: "ar",
      digits: "latin",
      theme: "dark",
      timezone: "Asia/Beirut",
      onboarded_at: "2026-01-01T00:00:00Z",
      salary_amount_minor: null,
      salary_balance_id: null,
      usd_lbp_rate: 89500,
      default_currency: "USD",
      salary_email_enabled: true,
    };
    const client = await connect(GOOD);
    const result = await client.callTool({ name: "profile_get", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ locale: "ar", theme: "dark", usdLbpRate: 89500, defaultCurrency: "USD" });
    expect(sdk.profileLookups).toEqual([["user_id", USER]]);
    const dataClient = sdk.clients.at(-1);
    expect(dataClient?.options.global?.headers?.Authorization).toBe(`Bearer ${GOOD}`);
    await client.close();
  });

  test("a failing tool returns a plain error without the original message", async () => {
    sdk.profileThrows = new Error("relation secret_table does not exist");
    const client = await connect(GOOD);
    const result = await client.callTool({ name: "profile_get", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "Something went wrong. Try again." }]);
    expect(JSON.stringify(result)).not.toContain("secret_table");
    await client.close();
  });

  test("a ToolError shows its message as a tool error", async () => {
    sdk.profileThrows = new ToolError("X");
    const client = await connect(GOOD);
    const result = await client.callTool({ name: "profile_get", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "X" }]);
    await client.close();
  });

  test("a plain Error keeps the generic text and never leaks its detail", async () => {
    sdk.profileThrows = new Error("secret detail");
    const client = await connect(GOOD);
    const result = await client.callTool({ name: "profile_get", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "Something went wrong. Try again." }]);
    expect(JSON.stringify(result)).not.toContain("secret detail");
    await client.close();
  });
});
