import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CookieOptions } from "@supabase/ssr";

const jar = vi.hoisted(() => ({
  current: new Map<string, string>(),
  writes: [] as { name: string; value: string; options: CookieOptions }[],
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => Array.from(jar.current, ([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: CookieOptions) => {
      jar.writes.push({ name, value, options });
      if (options.maxAge === 0) jar.current.delete(name);
      else jar.current.set(name, value);
    },
  }),
}));
import { createClient } from "./server";

// Real installed SSR/Auth SDK; only the Auth transport and Next cookie store are
// synthetic. This tests serialization/rotation defaults without backend secrets.
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-public-key");
  jar.current.clear();
  jar.writes = [];
  const part = (data: object) => Buffer.from(JSON.stringify(data)).toString("base64url");
  let tokenSequence = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes("/logout")) return new Response("{}", { status: 200 });
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
