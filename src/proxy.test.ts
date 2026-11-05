import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CookieMethodsServer } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

const auth = vi.hoisted(() => ({
  email: "PERSON@example.test" as string | null,
  writes: [] as { name: string; value: string; options: { path: string; maxAge: number; sameSite: "lax"; secure?: boolean } }[],
  headers: {} as Record<string, string>,
  calls: 0,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: CookieMethodsServer }) => ({
    auth: {
      getClaims: async () => {
        auth.calls++;
        await options.cookies.setAll!(auth.writes, auth.headers);
        return { data: auth.email ? { claims: { email: auth.email } } : null };
      },
    },
  }),
}));

// next-intl's external ESM imports extensionless next/server, which native Node
// cannot resolve in this Vitest setup. Model its request-header snapshot here;
// the configured-browser lane exercises the real middleware composition.
vi.mock("next-intl/middleware", () => ({
  default: () => (request: NextRequest) => {
    if (request.nextUrl.pathname === "/") {
      return NextResponse.redirect(new URL("/ar", request.url));
    }
    const headers = new Headers(request.headers);
    headers.set("x-next-intl-locale", request.nextUrl.pathname.split("/")[1]);
    const response = NextResponse.next({ request: { headers } });
    response.cookies.set("NEXT_LOCALE", headers.get("x-next-intl-locale")!);
    return response;
  },
}));

import { proxy } from "./proxy";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-public-key");
  auth.email = "PERSON@example.test";
  auth.calls = 0;
  auth.writes = [
    { name: "sb-synthetic-auth-token.0", value: "refreshed-part-one", options: { path: "/", maxAge: 34560000, sameSite: "lax", secure: true } },
    { name: "sb-synthetic-auth-token.1", value: "refreshed-part-two", options: { path: "/", maxAge: 34560000, sameSite: "lax", secure: true } },
    { name: "sb-synthetic-auth-token.2", value: "", options: { path: "/", maxAge: 0, sameSite: "lax" } },
  ];
  auth.headers = { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0", Expires: "0", Pragma: "no-cache" };
});

afterEach(() => vi.unstubAllEnvs());

function expectCookies(response: NextResponse) {
  for (const { name, value, options } of auth.writes) {
    expect(response.cookies.get(name)).toMatchObject({ name, value, ...options });
  }
  for (const [key, value] of Object.entries(auth.headers)) expect(response.headers.get(key)).toBe(value);
}

describe("session and locale response composition", () => {
  it.each(["en", "ar"])("keeps all rotated/removal cookies on the %s signed-in redirect", async (locale) => {
    const response = await proxy(new NextRequest(`https://budget.example/${locale}/sign-in`));
    expect(response.headers.get("location")).toBe(`https://budget.example/${locale}`);
    expectCookies(response);
    expect(response.cookies.get("NEXT_LOCALE")?.value).toBe(locale);
    expect(response.headers.has("x-middleware-next")).toBe(false);
    expect(auth.calls).toBe(1);
  });

  it.each(["en", "ar"])("keeps revoked-session removal cookies on the %s signed-out redirect", async (locale) => {
    auth.email = null;
    auth.writes = auth.writes.map((cookie) => ({ ...cookie, value: "", options: { ...cookie.options, maxAge: 0 } }));
    const response = await proxy(new NextRequest(`https://budget.example/${locale}/wallets`));
    expect(response.headers.get("location")).toBe(`https://budget.example/${locale}/sign-in`);
    expectCookies(response);
  });

  it("forwards refreshed cookies into the same Server Component request and keeps locale headers", async () => {
    const request = new NextRequest("https://budget.example/ar/wallets", {
      headers: { cookie: "sb-synthetic-auth-token.0=old; sb-synthetic-auth-token.2=stale; unrelated=keep", "rsc": "1" },
    });
    const response = await proxy(request);
    const forwarded = response.headers.get("x-middleware-request-cookie");
    expect(forwarded).toContain("sb-synthetic-auth-token.0=refreshed-part-one");
    expect(forwarded).toContain("unrelated=keep");
    expect(forwarded).not.toContain("=old");
    expect(forwarded).not.toContain("sb-synthetic-auth-token.2");
    expect(response.headers.get("x-middleware-request-x-next-intl-locale")).toBe("ar");
    expect(response.headers.get("x-middleware-request-rsc")).toBe("1");
    expectCookies(response);
  });

  it("preserves refresh cookies on locale redirects too", async () => {
    const response = await proxy(new NextRequest("https://budget.example/", { headers: { "accept-language": "ar" } }));
    expect(response.headers.get("location")).toBe("https://budget.example/ar");
    expectCookies(response);
  });

  it("keeps basePath on auth redirects", async () => {
    const response = await proxy(new NextRequest("https://budget.example/budget/ar/sign-in", { nextConfig: { basePath: "/budget" } }));
    expect(response.headers.get("location")).toBe("https://budget.example/budget/ar");
    expectCookies(response);
  });

  it("allows signed-out public pages but protects reset-password", async () => {
    auth.email = null;
    expect((await proxy(new NextRequest("https://budget.example/en/forgot-password"))).headers.has("location")).toBe(false);
    expect((await proxy(new NextRequest("https://budget.example/en/reset-password"))).headers.get("location")).toBe("https://budget.example/en/sign-in");
  });

  it("lets a signed-out export request reach the route's no-store 401 response", async () => {
    auth.email = null;
    const response = await proxy(new NextRequest("https://budget.example/en/settings/export"));
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expectCookies(response);
  });

  it("keeps demo mode without calling Supabase", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const response = await proxy(new NextRequest("https://budget.example/en/wallets"));
    expect(response.headers.has("location")).toBe(false);
    expect(response.cookies.has("sb-synthetic-auth-token.0")).toBe(false);
    expect(auth.calls).toBe(0);
  });

  it("keeps auth decisions private even when no token refresh writes cookies", async () => {
    auth.writes = [];
    auth.headers = {};
    const response = await proxy(new NextRequest("https://budget.example/en/sign-in"));
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cache-control")).toContain("private");
  });
});
