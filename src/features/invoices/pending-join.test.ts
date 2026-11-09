import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({
  values: new Map<string, string>(),
  deleted: [] as string[],
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name)! } : undefined),
    has: (name: string) => jar.values.has(name),
    delete: (name: string) => { jar.deleted.push(name); jar.values.delete(name); },
  }),
}));
import { forgetPendingJoin, hasPendingJoin, JOIN_COOKIE, joinPathFor, pendingJoinAfterSignIn, rememberJoin, takePendingJoin } from "./pending-join";

const token = "ab".repeat(32);
const me = "ac000000-0000-4000-8000-000000000009";

/** A profiles read that answers with the given onboarding state. */
function profiles(onboardedAt: string | null, error: { message: string } | null = null) {
  const calls: [string, unknown[]][] = [];
  const self: Record<string, unknown> = {};
  for (const method of ["select", "eq", "maybeSingle"]) self[method] = (...args: unknown[]) => { calls.push([method, args]); return self; };
  self.then = (resolve: (value: unknown) => unknown) => resolve({ data: error ? null : { onboarded_at: onboardedAt }, error });
  const from = vi.fn((table: string) => { calls.push(["from", [table]]); return self; });
  return { client: { from }, calls };
}

beforeEach(() => {
  jar.values.clear();
  jar.deleted.length = 0;
});

describe("rememberJoin", () => {
  it("is an httpOnly, lax, 24-hour cookie holding only the token", () => {
    expect(rememberJoin(token)).toEqual({
      name: JOIN_COOKIE, value: token, path: "/", httpOnly: true, sameSite: "lax", maxAge: 86400, secure: false,
    });
    expect(rememberJoin(token, { secure: true })?.secure).toBe(true);
    expect(JOIN_COOKIE).toBe("join_invoice");
  });

  it("refuses anything that is not a link token", () => {
    for (const value of ["../x", "ab".repeat(31) + "a", "AB".repeat(32), `${token}/x`, ""]) expect(rememberJoin(value)).toBeNull();
  });
});

describe("hasPendingJoin", () => {
  it("only reads the cookie", async () => {
    expect(await hasPendingJoin()).toBe(false);
    jar.values.set(JOIN_COOKIE, token);
    expect(await hasPendingJoin()).toBe(true);
    expect(jar.values.has(JOIN_COOKIE)).toBe(true);
  });
});

describe("forgetPendingJoin", () => {
  it("clears the remembered link, and is fine when there is none", async () => {
    jar.values.set(JOIN_COOKIE, token);
    await forgetPendingJoin();
    expect(jar.values.has(JOIN_COOKIE)).toBe(false);
    expect(jar.deleted).toEqual([JOIN_COOKIE]);
    await expect(forgetPendingJoin()).resolves.toBeUndefined();
  });
});

describe("joinPathFor", () => {
  it("builds the path only from a valid token", () => {
    expect(joinPathFor(token)).toBe(`/invoices/join/${token}`);
    for (const value of ["../x", "ab".repeat(31) + "a", `${token}?next=//evil.example`, "https://evil.example", undefined, null, 7]) {
      expect(joinPathFor(value)).toBeNull();
    }
  });
});

describe("takePendingJoin", () => {
  it("yields the join path once, then null", async () => {
    jar.values.set(JOIN_COOKIE, token);
    expect(await takePendingJoin()).toBe(`/invoices/join/${token}`);
    expect(jar.deleted).toEqual([JOIN_COOKIE]);
    expect(await takePendingJoin()).toBeNull();
  });

  it.each(["../x", "ab".repeat(31) + "a", `${token}/../../evil`])("ignores and clears a tampered cookie (%s)", async (value) => {
    jar.values.set(JOIN_COOKIE, value);
    expect(await takePendingJoin()).toBeNull();
    expect(jar.values.has(JOIN_COOKIE)).toBe(false);
  });

  it("is null without a cookie and touches nothing", async () => {
    expect(await takePendingJoin()).toBeNull();
    expect(jar.deleted).toEqual([]);
  });
});

describe("pendingJoinAfterSignIn", () => {
  it("takes the link for a set-up account", async () => {
    jar.values.set(JOIN_COOKIE, token);
    const { client, calls } = profiles("2026-11-01T00:00:00Z");
    expect(await pendingJoinAfterSignIn(client as never, me)).toBe(`/invoices/join/${token}`);
    expect(calls).toContainEqual(["eq", ["user_id", me]]);
    expect(jar.values.has(JOIN_COOKIE)).toBe(false);
  });

  it("keeps the link for a new account so onboarding can use it when it finishes", async () => {
    jar.values.set(JOIN_COOKIE, token);
    expect(await pendingJoinAfterSignIn(profiles(null).client as never, me)).toBeNull();
    expect(jar.values.get(JOIN_COOKIE)).toBe(token);
  });

  it("keeps the link when the profile cannot be read", async () => {
    jar.values.set(JOIN_COOKIE, token);
    expect(await pendingJoinAfterSignIn(profiles(null, { message: "down" }).client as never, me)).toBeNull();
    expect(jar.values.get(JOIN_COOKIE)).toBe(token);
  });

  it("does not read the profile when no link was remembered", async () => {
    const { client } = profiles("2026-11-01T00:00:00Z");
    expect(await pendingJoinAfterSignIn(client as never, me)).toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("clears a tampered cookie without reading the profile", async () => {
    jar.values.set(JOIN_COOKIE, "../x");
    const { client } = profiles("2026-11-01T00:00:00Z");
    expect(await pendingJoinAfterSignIn(client as never, me)).toBeNull();
    expect(client.from).not.toHaveBeenCalled();
    expect(jar.values.has(JOIN_COOKIE)).toBe(false);
  });
});
