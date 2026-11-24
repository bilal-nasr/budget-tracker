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
import {
  AUTHORIZATION_COOKIE,
  authorizationIdSchema,
  connectPathFor,
  forgetPendingAuthorization,
  hasPendingAuthorization,
  pendingAuthorizationAfterSignIn,
  rememberAuthorization,
  takePendingAuthorization,
} from "./pending-authorization";

const id = "3f1c6a2e-9b7d-4c1a-8e2f-0a1b2c3d4e5f";
const me = "ac000000-0000-4000-8000-000000000009";
const TAMPERED = ["../x", "short", "a".repeat(129), `${id}/x`, `${id}?next=//evil.example`, "https://evil.example", "id with space", ""];

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

describe("authorizationIdSchema", () => {
  it("accepts 8 to 128 letters, digits, - and _ only", () => {
    for (const value of [id, "abc12345", "A_b-C".padEnd(128, "z")]) expect(authorizationIdSchema.safeParse(value).success).toBe(true);
    for (const value of [...TAMPERED, "abc1234", 12345678, null, undefined]) expect(authorizationIdSchema.safeParse(value).success).toBe(false);
  });
});

describe("rememberAuthorization", () => {
  it("is an httpOnly, lax, one-hour cookie holding only the id", () => {
    expect(rememberAuthorization(id)).toEqual({
      name: AUTHORIZATION_COOKIE, value: id, path: "/", httpOnly: true, sameSite: "lax", maxAge: 3600, secure: false,
    });
    expect(rememberAuthorization(id, { secure: true })?.secure).toBe(true);
    expect(AUTHORIZATION_COOKIE).toBe("connect_authorization");
  });

  it.each(TAMPERED)("refuses anything that is not an authorization id (%s)", (value) => {
    expect(rememberAuthorization(value)).toBeNull();
  });
});

describe("connectPathFor", () => {
  it("builds the path only from a valid id", () => {
    expect(connectPathFor(id)).toBe(`/connect?authorization_id=${id}`);
    for (const value of [...TAMPERED, undefined, null, 7]) expect(connectPathFor(value)).toBeNull();
  });
});

describe("hasPendingAuthorization", () => {
  it("only reads the cookie", async () => {
    expect(await hasPendingAuthorization()).toBe(false);
    jar.values.set(AUTHORIZATION_COOKIE, id);
    expect(await hasPendingAuthorization()).toBe(true);
    expect(jar.values.has(AUTHORIZATION_COOKIE)).toBe(true);
  });
});

describe("forgetPendingAuthorization", () => {
  it("clears the remembered authorization, and is fine when there is none", async () => {
    jar.values.set(AUTHORIZATION_COOKIE, id);
    await forgetPendingAuthorization();
    expect(jar.values.has(AUTHORIZATION_COOKIE)).toBe(false);
    expect(jar.deleted).toEqual([AUTHORIZATION_COOKIE]);
    await expect(forgetPendingAuthorization()).resolves.toBeUndefined();
  });
});

describe("takePendingAuthorization", () => {
  it("yields the connect path once, then null", async () => {
    jar.values.set(AUTHORIZATION_COOKIE, id);
    expect(await takePendingAuthorization()).toBe(`/connect?authorization_id=${id}`);
    expect(jar.deleted).toEqual([AUTHORIZATION_COOKIE]);
    expect(await takePendingAuthorization()).toBeNull();
  });

  it.each(TAMPERED)("ignores and clears a tampered cookie (%s)", async (value) => {
    jar.values.set(AUTHORIZATION_COOKIE, value);
    expect(await takePendingAuthorization()).toBeNull();
    expect(jar.values.has(AUTHORIZATION_COOKIE)).toBe(false);
  });

  it("is null without a cookie and touches nothing", async () => {
    expect(await takePendingAuthorization()).toBeNull();
    expect(jar.deleted).toEqual([]);
  });
});

describe("pendingAuthorizationAfterSignIn", () => {
  it("takes the authorization for a set-up account", async () => {
    jar.values.set(AUTHORIZATION_COOKIE, id);
    const { client, calls } = profiles("2026-11-01T00:00:00Z");
    expect(await pendingAuthorizationAfterSignIn(client as never, me)).toBe(`/connect?authorization_id=${id}`);
    expect(calls).toContainEqual(["eq", ["user_id", me]]);
    expect(jar.values.has(AUTHORIZATION_COOKIE)).toBe(false);
  });

  it("keeps it for a new account so onboarding can use it when it finishes", async () => {
    jar.values.set(AUTHORIZATION_COOKIE, id);
    expect(await pendingAuthorizationAfterSignIn(profiles(null).client as never, me)).toBeNull();
    expect(jar.values.get(AUTHORIZATION_COOKIE)).toBe(id);
  });

  it("keeps it when the profile cannot be read", async () => {
    jar.values.set(AUTHORIZATION_COOKIE, id);
    expect(await pendingAuthorizationAfterSignIn(profiles(null, { message: "down" }).client as never, me)).toBeNull();
    expect(jar.values.get(AUTHORIZATION_COOKIE)).toBe(id);
  });

  it("does not read the profile when nothing was remembered", async () => {
    const { client } = profiles("2026-11-01T00:00:00Z");
    expect(await pendingAuthorizationAfterSignIn(client as never, me)).toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("clears a tampered cookie without reading the profile", async () => {
    jar.values.set(AUTHORIZATION_COOKIE, "../x");
    const { client } = profiles("2026-11-01T00:00:00Z");
    expect(await pendingAuthorizationAfterSignIn(client as never, me)).toBeNull();
    expect(client.from).not.toHaveBeenCalled();
    expect(jar.values.has(AUTHORIZATION_COOKIE)).toBe(false);
  });
});
