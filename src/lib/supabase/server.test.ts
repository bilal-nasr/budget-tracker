import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CookieOptions } from "@supabase/ssr";

const jar = vi.hoisted(() => ({
  current: new Map<string, string>(),
  writes: [] as { name: string; value: string; options: CookieOptions }[],
  cookieCalls: 0,
  cookiesThrow: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => {
    jar.cookieCalls++;
    if (jar.cookiesThrow) throw new Error("cookies() must not be called during a connector request");
    return {
      getAll: () => Array.from(jar.current, ([name, value]) => ({ name, value })),
      set: (name: string, value: string, options: CookieOptions) => {
        jar.writes.push({ name, value, options });
        if (options.maxAge === 0) jar.current.delete(name);
        else jar.current.set(name, value);
      },
    };
  },
}));
// Wraps the real factory so the options handed to it can be inspected; @supabase/ssr
// keeps its own (unwrapped) import, so the cookie path is unaffected.
const sdk = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/supabase-js")>();
  return {
    ...actual,
    createClient: (...args: Parameters<typeof actual.createClient>) => {
      sdk.calls.push(args);
      return actual.createClient(...args);
    },
  };
});
import { createClient } from "./server";
import { runAsConnector } from "./request-context";
import { getUserEmail } from "./user";

// Real installed SSR/Auth SDK; only the Auth transport and Next cookie store are
// synthetic. This tests serialization/rotation defaults without backend secrets.
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-public-key");
  jar.current.clear();
  jar.writes = [];
  jar.cookieCalls = 0;
  jar.cookiesThrow = false;
  sdk.calls = [];
  const part = (data: object) => Buffer.from(JSON.stringify(data)).toString("base64url");
  let tokenSequence = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.includes("/logout")) return new Response("{}", { status: 200 });
    if (path.includes("/rest/v1/")) return Response.json([]);
    if (path.endsWith("/auth/v1/user")) {
      const bearer = new Headers(init?.headers).get("Authorization");
      const email = bearer === "Bearer tok" ? "connector@example.test" : "person@example.test";
      return Response.json({ id: "synthetic-user", email, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
    }
    const now = Math.floor(Date.now() / 1000);
    const accessToken = `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: "synthetic-user", exp: now + 3600, iat: now, role: "authenticated" })}.synthetic-signature`;
    return Response.json({
      access_token: accessToken, refresh_token: `synthetic-refresh-token-${++tokenSequence}`, token_type: "bearer", expires_in: 3600,
      user: { id: "synthetic-user", email: "person@example.test", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("rotates an expired access session and stores the new pair for the next server request", async () => {
  const client = await createClient();
  const { data } = await client.auth.signInWithPassword({ email: "person@example.test", password: "synthetic-password" });
  const oldToken = data.session!.refresh_token;
  const later = Date.now() + 3601 * 1000;
  vi.spyOn(Date, "now").mockReturnValue(later);
  const nextRequest = await createClient();
  const refreshed = (await nextRequest.auth.getSession()).data.session;
  expect(refreshed?.refresh_token).not.toBe(oldToken);
  expect(refreshed?.expires_at).toBeGreaterThan(later / 1000);
  const restored = await createClient();
  expect((await restored.auth.getSession()).data.session?.refresh_token).toBe(refreshed?.refresh_token);
});

it("persists a one-hour access session in long-lived SSR cookies across new server clients", async () => {
  const client = await createClient();
  const { error } = await client.auth.signInWithPassword({ email: "person@example.test", password: "synthetic-password" });
  expect(error).toBeNull();
  expect(jar.writes.length).toBeGreaterThan(0);
  for (const { options } of jar.writes.filter(({ value }) => value !== "")) {
    expect(options).toMatchObject({ maxAge: 400 * 86400, path: "/", sameSite: "lax", httpOnly: false });
  }
  const restored = await createClient();
  const { data } = await restored.auth.getSession();
  // getSession is used only to inspect synthetic SDK storage, never to authorize.
  expect(data.session?.user.id).toBe("synthetic-user");
  expect(data.session?.expires_in).toBe(3600);
});

it("expires every old chunk on global sign-out without a persistence override resurrecting it", async () => {
  const client = await createClient();
  await client.auth.signInWithPassword({ email: "person@example.test", password: "synthetic-password" });
  const names = Array.from(jar.current.keys());
  jar.writes = [];
  expect((await client.auth.signOut()).error).toBeNull();
  for (const name of names) {
    expect(jar.writes).toContainEqual(expect.objectContaining({ name, value: "", options: expect.objectContaining({ maxAge: 0 }) }));
  }
  const restored = await createClient();
  expect((await restored.auth.getSession()).data.session).toBeNull();
});

const connector = { accessToken: "tok", userId: "connector-user" };
const sentHeaders = (match: string) => {
  const call = vi.mocked(fetch).mock.calls.find(([input]) => String(input).includes(match));
  expect(call).toBeDefined();
  return new Headers(call![1]?.headers);
};

it("inside a connector request the client sends the bearer token and cookies() is never called", async () => {
  jar.cookiesThrow = true;
  const client = await runAsConnector(connector, () => createClient());
  expect(jar.cookieCalls).toBe(0);
  expect(sdk.calls).toHaveLength(1);
  const [url, key, options] = sdk.calls[0] as [string, string, { global: { headers: Record<string, string> }; auth: object }];
  expect(url).toBe("https://synthetic.supabase.co");
  expect(key).toBe("synthetic-public-key");
  expect(options.global.headers.Authorization).toBe("Bearer tok");
  expect(options.auth).toEqual({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  await client.from("wallets").select("id");
  expect(sentHeaders("/rest/v1/wallets").get("Authorization")).toBe("Bearer tok");
  expect(jar.cookieCalls).toBe(0);
  expect(jar.writes).toEqual([]);
});

it("extra headers (x-budget-units) are kept alongside the bearer token", async () => {
  jar.cookiesThrow = true;
  const units = JSON.stringify({ USD: 2 });
  const client = await runAsConnector(connector, () => createClient({ "x-budget-units": units }));
  const options = sdk.calls[0]![2] as { global: { headers: Record<string, string> } };
  expect(options.global.headers).toEqual({ "x-budget-units": units, Authorization: "Bearer tok" });
  await client.from("wallets").select("id");
  const headers = sentHeaders("/rest/v1/wallets");
  expect(headers.get("Authorization")).toBe("Bearer tok");
  expect(headers.get("x-budget-units")).toBe(units);
  expect(jar.cookieCalls).toBe(0);
});

it("a caller-supplied Authorization header cannot replace the connector's bearer token", async () => {
  jar.cookiesThrow = true;
  await runAsConnector(connector, () => createClient({ Authorization: "Bearer someone-else", authorization: "Bearer another" }));
  const options = sdk.calls[0]![2] as { global: { headers: Record<string, string> } };
  expect(options.global.headers).toEqual({ Authorization: "Bearer tok" });
});

it("outside a connector request the client still reads the cookie store and never builds a bearer client", async () => {
  await createClient({ "x-budget-units": "{}" });
  expect(jar.cookieCalls).toBe(1);
  expect(sdk.calls).toHaveLength(0);
});

it("getUserEmail reads the connector user's email with its token and no cookies", async () => {
  jar.cookiesThrow = true;
  await expect(runAsConnector(connector, () => getUserEmail())).resolves.toBe("connector@example.test");
  expect(sentHeaders("/auth/v1/user").get("Authorization")).toBe("Bearer tok");
  expect(jar.cookieCalls).toBe(0);
});

it("getUserEmail outside a connector request reads the signed-in cookie session", async () => {
  const client = await createClient();
  await client.auth.signInWithPassword({ email: "person@example.test", password: "synthetic-password" });
  await expect(getUserEmail()).resolves.toBe("person@example.test");
});

it("getUserEmail is null when nobody is signed in", async () => {
  await expect(getUserEmail()).resolves.toBeNull();
});
