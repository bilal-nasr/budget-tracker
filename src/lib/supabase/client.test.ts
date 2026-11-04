// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createClient } from "./client";

it("uses the installed SSR browser cookie storage with the same persistent lifetime and deletion semantics", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-public-key");
  const part = (value: object) => btoa(JSON.stringify(value)).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
  const accessToken = `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: "synthetic-user", exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic-signature`;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/logout")
    ? new Response("{}", { status: 200 })
    : Response.json({ access_token: accessToken, refresh_token: "synthetic-browser-refresh", expires_in: 3600, token_type: "bearer", user: { id: "synthetic-user", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } })));
  const writes = vi.spyOn(document, "cookie", "set");
  const client = createClient();
  try {
    const { error } = await client.auth.signInWithPassword({ email: "person@example.test", password: "synthetic-password" });
    expect(error).toBeNull();
    expect(document.cookie).toContain("sb-synthetic-auth-token=");
    expect(writes.mock.calls.some(([cookie]) => cookie.includes("Max-Age=34560000") && cookie.includes("Path=/") && cookie.includes("SameSite=Lax"))).toBe(true);
    await client.auth.signOut();
    expect(document.cookie).not.toContain("sb-synthetic-auth-token=");
    expect(writes.mock.calls.some(([cookie]) => cookie.includes("Max-Age=0"))).toBe(true);
  } finally {
    await client.auth.stopAutoRefresh();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
