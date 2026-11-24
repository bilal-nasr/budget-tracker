import { beforeEach, expect, test, vi } from "vitest";

const probe = vi.hoisted(() => ({ cookieCalls: 0, createClientCalls: 0 }));
vi.mock("server-only", () => ({}));
// A connector request must never read the cookie store: any call fails the test.
vi.mock("next/headers", () => ({
  cookies: async () => {
    probe.cookieCalls++;
    throw new Error("cookies() must not be called during a connector request");
  },
}));
// Outside React's server renderer `cache` is a pass-through; this stand-in memoises
// forever, so a context check placed inside the cached function would leak the first user.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
    let hit: { value: R } | undefined;
    return (...args: A): R => (hit ??= { value: fn(...args) }).value;
  },
}));
vi.mock("./server", () => ({
  createClient: async () => {
    probe.createClientCalls++;
    throw new Error("getUserId must not build a client during a connector request");
  },
}));
import { connectorContext, runAsConnector, throwInConnector } from "./request-context";
import { getUserId } from "./user";

beforeEach(() => {
  probe.cookieCalls = 0;
  probe.createClientCalls = 0;
});

test("no context outside runAsConnector", () => {
  expect(connectorContext()).toBeUndefined();
});

test("the context ends when runAsConnector settles, including on failure", async () => {
  await runAsConnector({ accessToken: "t", userId: "u" }, async () => {
    expect(connectorContext()).toEqual({ accessToken: "t", userId: "u" });
  });
  expect(connectorContext()).toBeUndefined();
  await expect(runAsConnector({ accessToken: "t", userId: "u" }, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  expect(connectorContext()).toBeUndefined();
});

test("runAsConnector returns the callback's value", async () => {
  await expect(runAsConnector({ accessToken: "t", userId: "u" }, async () => 42)).resolves.toBe(42);
});

test("overlapping requests keep their own identity", async () => {
  const seen: string[] = [];
  const job = (id: string, wait: number) => runAsConnector({ accessToken: `t-${id}`, userId: id }, async () => {
    await new Promise((r) => setTimeout(r, wait));
    seen.push(`${id}:${connectorContext()!.userId}:${connectorContext()!.accessToken}`);
  });
  await Promise.all([job("a", 20), job("b", 5)]);
  expect(seen.sort()).toEqual(["a:a:t-a", "b:b:t-b"]);
});

test("getUserId returns the context user and never touches cookies", async () => {
  await expect(runAsConnector({ accessToken: "tok-1", userId: "u1" }, () => getUserId())).resolves.toBe("u1");
  expect(probe.cookieCalls).toBe(0);
  expect(probe.createClientCalls).toBe(0);
});

test("getUserId for two users in sequence does not return a cached first user", async () => {
  const first = await runAsConnector({ accessToken: "tok-1", userId: "u1" }, () => getUserId());
  const second = await runAsConnector({ accessToken: "tok-2", userId: "u2" }, () => getUserId());
  expect([first, second]).toEqual(["u1", "u2"]);
  expect(probe.cookieCalls).toBe(0);
});

test("throwInConnector throws a plain Error inside a connector request", async () => {
  await expect(runAsConnector({ accessToken: "t", userId: "u" }, async () => throwInConnector("Transactions unavailable")))
    .rejects.toThrow(new Error("Transactions unavailable"));
});

test("throwInConnector does nothing outside a connector request, so the caller keeps its fallback", () => {
  expect(() => throwInConnector("Transactions unavailable")).not.toThrow();
});
