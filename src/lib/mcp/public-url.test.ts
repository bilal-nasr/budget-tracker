import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { authServerIssuer, fetchAuthServerMetadata, mcpUrl } from "./public-url";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("mcpUrl", () => {
  test("uses the configured site, not the request origin", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://budget.example.com/");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
    expect(mcpUrl("http://localhost:3000")).toBe("https://budget.example.com/mcp");
  });

  test("appends the base path", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://budget.example.com");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/budget");
    expect(mcpUrl("http://localhost:3000")).toBe("https://budget.example.com/budget/mcp");
  });

  test("falls back to the request origin when unset", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
    expect(mcpUrl("http://localhost:3000")).toBe("http://localhost:3000/mcp");
  });
});

test("authServerIssuer is the project's /auth/v1", () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321/");
  expect(authServerIssuer()).toBe("http://127.0.0.1:54321/auth/v1");
});

describe("fetchAuthServerMetadata", () => {
  const metadata = (base: string) => ({
    issuer: `${base}/auth/v1`,
    authorization_endpoint: `${base}/auth/v1/oauth/authorize`,
    token_endpoint: `${base}/auth/v1/oauth/token`,
    response_types_supported: ["code"],
  });
  // Each test uses its own project URL so the module-level cache never leaks between tests.
  let base: string;
  let counter = 0;
  beforeEach(() => {
    base = `https://project-${++counter}.supabase.test`;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", base);
  });

  test("uses the /auth/v1/.well-known address first (local stack)", async () => {
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url) === `${base}/auth/v1/.well-known/oauth-authorization-server`
        ? Response.json(metadata(base))
        : new Response("not found", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAuthServerMetadata()).resolves.toMatchObject({ issuer: `${base}/auth/v1` });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("falls back to the root /.well-known/…/auth/v1 address (hosted)", async () => {
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url) === `${base}/.well-known/oauth-authorization-server/auth/v1`
        ? Response.json(metadata(base))
        : new Response("not found", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAuthServerMetadata()).resolves.toMatchObject({ token_endpoint: `${base}/auth/v1/oauth/token` });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `${base}/auth/v1/.well-known/oauth-authorization-server`,
      `${base}/.well-known/oauth-authorization-server/auth/v1`,
    ]);
  });

  test("a network error on the first address still tries the second", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/auth/v1/.well-known/")) throw new TypeError("fetch failed");
      return Response.json(metadata(base));
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAuthServerMetadata()).resolves.toMatchObject({ issuer: `${base}/auth/v1` });
  });

  test("a success is cached for one hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T10:00:00Z"));
    const fetchMock = vi.fn(async () => Response.json(metadata(base)));
    vi.stubGlobal("fetch", fetchMock);
    await fetchAuthServerMetadata();
    vi.setSystemTime(new Date("2026-11-24T10:59:00Z"));
    await fetchAuthServerMetadata();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-11-24T11:01:00Z"));
    await fetchAuthServerMetadata();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("a failure is not cached", async () => {
    const down = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    vi.stubGlobal("fetch", down);
    await expect(fetchAuthServerMetadata()).resolves.toBeNull();
    expect(down).toHaveBeenCalledTimes(2);
    const up = vi.fn(async () => Response.json(metadata(base)));
    vi.stubGlobal("fetch", up);
    await expect(fetchAuthServerMetadata()).resolves.toMatchObject({ issuer: `${base}/auth/v1` });
    expect(up).toHaveBeenCalledTimes(1);
  });

  test("a body that is not authorization-server metadata counts as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ hello: "world" })));
    await expect(fetchAuthServerMetadata()).resolves.toBeNull();
  });

  test("each address is fetched with a 5 second timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(async () => new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchAuthServerMetadata();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenCalledWith(5000);
    for (const [, init] of fetchMock.mock.calls) expect(init?.signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  test("an address that times out is skipped like any other failure", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/auth/v1/.well-known/")) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      return Response.json(metadata(base));
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAuthServerMetadata()).resolves.toMatchObject({ issuer: `${base}/auth/v1` });
  });

  test("not configured → null without fetching", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAuthServerMetadata()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
