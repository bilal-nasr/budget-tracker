import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Synthetic Supabase: records each connector_clients lookup and answers from `sdk.answer`.
const sdk = vi.hoisted(() => ({
  // When set, createClient is the real supabase-js one (with whatever global fetch is stubbed).
  real: null as null | ((...args: unknown[]) => unknown),
  useReal: false,
  clients: [] as { url: string; key: string; options: { global?: { headers?: Record<string, string> }; auth?: Record<string, unknown> } }[],
  lookups: [] as { table: string; columns: string; filter: [string, unknown] }[],
  answer: (async () => ({ data: null, error: null, status: 200 })) as (clientId: unknown) => Promise<{ data: unknown; error: unknown; status?: number }>,
}));
vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/supabase-js")>();
  sdk.real = actual.createClient as unknown as (...args: unknown[]) => unknown;
  return {
  ...actual,
  createClient: (url: string, key: string, options: (typeof sdk.clients)[number]["options"]) => {
    if (sdk.useReal) return sdk.real!(url, key, options);
    sdk.clients.push({ url, key, options });
    return {
      from: (table: string) => ({
        select: (columns: string) => ({
          eq: (column: string, value: unknown) => {
            sdk.lookups.push({ table, columns, filter: [column, value] });
            const chain = {
              abortSignal: () => chain,
              maybeSingle: () => sdk.answer(value),
            };
            return chain;
          },
        }),
      }),
    };
  },
  };
});
vi.mock("next/headers", () => ({
  cookies: () => {
    throw new Error("the client check must never touch cookies");
  },
}));
import { ALLOWED_CACHE_MAX, AllowlistUnavailableError, allowedClientCacheSize, clearAllowedClientCache, isAllowedClient } from "./clients";

const LISTED = "client-listed";
// Two sessions of the same app (two people, or two connections of one person).
const S1 = "5e550000-0000-4000-8000-000000000001";
const S2 = "5e550000-0000-4000-8000-000000000002";
const sessionN = (n: number) => `5e550000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const listed = async (clientId: unknown) =>
  clientId === LISTED ? { data: { client_id: LISTED }, error: null, status: 200 } : { data: null, error: null, status: 200 };

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-public-key");
  sdk.clients = [];
  sdk.lookups = [];
  sdk.answer = listed;
  sdk.useReal = false;
  clearAllowedClientCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("a listed client is allowed, looked up with the caller's own token and no session", async () => {
  await expect(isAllowedClient(LISTED, S1, "tok-1")).resolves.toBe(true);
  expect(sdk.lookups).toEqual([{ table: "connector_clients", columns: "client_id", filter: ["client_id", LISTED] }]);
  const made = sdk.clients[0];
  expect(made.url).toBe("https://synthetic.supabase.test");
  expect(made.key).toBe("synthetic-public-key");
  expect(made.options.global?.headers?.Authorization).toBe("Bearer tok-1");
  expect(made.options.auth).toMatchObject({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
});

test("a positive answer is cached for 60 s per client id and session, then asked again", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-24T10:00:00Z") });
  await expect(isAllowedClient(LISTED, S1, "tok-1")).resolves.toBe(true);
  vi.setSystemTime(new Date("2026-11-24T10:00:59Z"));
  await expect(isAllowedClient(LISTED, S1, "tok-2")).resolves.toBe(true);
  expect(sdk.lookups).toHaveLength(1);
  vi.setSystemTime(new Date("2026-11-24T10:01:00.001Z"));
  sdk.answer = async () => ({ data: null, error: null }); // removed from the list meanwhile
  await expect(isAllowedClient(LISTED, S1, "tok-2")).resolves.toBe(false);
  expect(sdk.lookups).toHaveLength(2);
});

test("an unlisted client is refused and asked again next time (no negative cache)", async () => {
  await expect(isAllowedClient("client-other", S1, "tok")).resolves.toBe(false);
  await expect(isAllowedClient("client-other", S1, "tok")).resolves.toBe(false);
  expect(sdk.lookups).toHaveLength(2);
  // Listed a moment later: allowed at once.
  sdk.answer = async () => ({ data: { client_id: "client-other" }, error: null });
  await expect(isAllowedClient("client-other", S1, "tok")).resolves.toBe(true);
});

test("a refused lookup (the database guard's 403 for an unlisted app's own token) is false and not cached", async () => {
  sdk.answer = async () => ({ data: null, error: { code: "42501", message: "connector.forbidden" }, status: 403 });
  await expect(isAllowedClient(LISTED, S1, "tok")).resolves.toBe(false);
  sdk.answer = listed;
  await expect(isAllowedClient(LISTED, S1, "tok")).resolves.toBe(true);
  expect(sdk.lookups).toHaveLength(2);
});

describe("an outage is not a refusal: it throws AllowlistUnavailableError, carries no Supabase text, and caches nothing", () => {
  const cases: [string, () => Promise<{ data: unknown; error: unknown; status?: number }>][] = [
    ["a thrown failed fetch", async () => { throw Object.assign(new TypeError("fetch failed"), { cause: new Error("ECONNREFUSED") }); }],
    ["a transport failure postgrest-js reports as status 0", async () => ({ data: null, error: { code: "", message: "TypeError: fetch failed" }, status: 0 })],
    ["a 503 from the API", async () => ({ data: null, error: { code: "PGRST002", message: "Could not query the database" }, status: 503 })],
    ["a 500 from the API", async () => ({ data: null, error: { code: "XX000", message: "internal" }, status: 500 })],
    ["a 408 from the API (request timeout)", async () => ({ data: null, error: { code: "", message: "Could not query in time" }, status: 408 })],
    ["a 429 from the API (rate limited)", async () => ({ data: null, error: { code: "", message: "Could not query, too many requests" }, status: 429 })],
  ];
  test.each(cases)("%s", async (_name, answer) => {
    sdk.answer = answer;
    const error = await isAllowedClient(LISTED, S1, "tok").then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AllowlistUnavailableError);
    expect((error as Error).message).not.toMatch(/fetch failed|ECONNREFUSED|Could not query|internal/);
    sdk.answer = listed;
    await expect(isAllowedClient(LISTED, S1, "tok")).resolves.toBe(true);
    expect(sdk.lookups).toHaveLength(2);
  });

  test("a 401 from the API (token no longer accepted) is a refusal, not an outage", async () => {
    sdk.answer = async () => ({ data: null, error: { code: "PGRST303", message: "JWT expired" }, status: 401 });
    await expect(isAllowedClient(LISTED, S1, "tok")).resolves.toBe(false);
  });
});

test("a lookup that hangs is aborted after 5 s by the real client (slow fetch) and surfaces as an outage", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-24T10:00:00Z") });
  sdk.useReal = true;
  const seen: { signal?: AbortSignal; url: string }[] = [];
  // Never answers on its own; settles only when its signal aborts, as a real fetch does.
  vi.stubGlobal("fetch", (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), signal: init?.signal ?? undefined });
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason ?? new DOMException("aborted", "AbortError")));
    });
  });
  const outcome = isAllowedClient(LISTED, S1, "tok").then(() => "resolved", (e: unknown) => e);
  await vi.advanceTimersByTimeAsync(4_999);
  expect(seen).toHaveLength(1);
  expect(seen[0].url).toContain("/rest/v1/connector_clients");
  expect(seen[0].signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(2);
  const error = await outcome;
  expect(seen[0].signal?.aborted).toBe(true);
  expect(error).toBeInstanceOf(AllowlistUnavailableError);
  expect(seen).toHaveLength(1); // an aborted lookup is not retried
  // Not cached: the next call asks again.
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ client_id: LISTED }), { status: 200, headers: { "content-type": "application/json" } }));
  await expect(isAllowedClient(LISTED, S1, "tok")).resolves.toBe(true);
});

test("a row for a different client id never allows this one", async () => {
  sdk.answer = async () => ({ data: { client_id: "someone-else" }, error: null });
  await expect(isAllowedClient(LISTED, S1, "tok")).resolves.toBe(false);
});

test("an empty client id, session id or token is refused without a lookup", async () => {
  await expect(isAllowedClient("", S1, "tok")).resolves.toBe(false);
  await expect(isAllowedClient(LISTED, "", "tok")).resolves.toBe(false);
  await expect(isAllowedClient(LISTED, S1, "")).resolves.toBe(false);
  expect(sdk.lookups).toHaveLength(0);
});

test("a positive for one session of an app never admits another session of the same app", async () => {
  await expect(isAllowedClient(LISTED, S1, "tok-a")).resolves.toBe(true);
  // B's session was revoked: the database guard refuses B's own token for the lookup.
  sdk.answer = async () => ({ data: null, error: { code: "42501", message: "connector.forbidden" }, status: 403 });
  await expect(isAllowedClient(LISTED, S2, "tok-b")).resolves.toBe(false);
  await expect(isAllowedClient(LISTED, S2, "tok-b")).resolves.toBe(false);
  expect(sdk.lookups).toHaveLength(3);
  // A's cached session keeps working meanwhile, without a lookup.
  await expect(isAllowedClient(LISTED, S1, "tok-a")).resolves.toBe(true);
  expect(sdk.lookups).toHaveLength(3);
});

test("expired entries are pruned when a new answer is cached", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-24T10:00:00Z") });
  for (const n of [1, 2, 3]) await expect(isAllowedClient(LISTED, sessionN(n), "tok")).resolves.toBe(true);
  expect(allowedClientCacheSize()).toBe(3);
  vi.setSystemTime(new Date("2026-11-24T10:00:30Z"));
  await expect(isAllowedClient(LISTED, sessionN(4), "tok")).resolves.toBe(true);
  expect(allowedClientCacheSize()).toBe(4);
  // 1–3 expired at 10:01:00; 4 is still good until 10:01:30.
  vi.setSystemTime(new Date("2026-11-24T10:01:01Z"));
  await expect(isAllowedClient(LISTED, sessionN(5), "tok")).resolves.toBe(true);
  expect(allowedClientCacheSize()).toBe(2);
  expect(sdk.lookups).toHaveLength(5);
  await expect(isAllowedClient(LISTED, sessionN(4), "tok")).resolves.toBe(true);
  expect(sdk.lookups).toHaveLength(5);
});

test("the cache never holds more than its cap; the oldest entries go first", async () => {
  for (let n = 1; n <= ALLOWED_CACHE_MAX + 5; n += 1) await isAllowedClient(LISTED, sessionN(n), "tok");
  expect(allowedClientCacheSize()).toBe(ALLOWED_CACHE_MAX);
  const lookups = sdk.lookups.length;
  // The newest is still cached; the first one was evicted and is looked up again.
  await expect(isAllowedClient(LISTED, sessionN(ALLOWED_CACHE_MAX + 5), "tok")).resolves.toBe(true);
  expect(sdk.lookups).toHaveLength(lookups);
  await expect(isAllowedClient(LISTED, sessionN(1), "tok")).resolves.toBe(true);
  expect(sdk.lookups).toHaveLength(lookups + 1);
  expect(allowedClientCacheSize()).toBe(ALLOWED_CACHE_MAX);
});

test("refusals and outages add nothing to the cache", async () => {
  sdk.answer = async () => ({ data: null, error: null, status: 200 });
  await isAllowedClient(LISTED, S1, "tok");
  sdk.answer = async () => ({ data: null, error: { code: "XX000", message: "internal" }, status: 500 });
  await isAllowedClient(LISTED, S2, "tok").catch(() => {});
  expect(allowedClientCacheSize()).toBe(0);
});

test("a cached answer for one client id says nothing about another", async () => {
  await expect(isAllowedClient(LISTED, S1, "tok")).resolves.toBe(true);
  await expect(isAllowedClient("client-other", S1, "tok")).resolves.toBe(false);
  expect(sdk.lookups).toHaveLength(2);
});
