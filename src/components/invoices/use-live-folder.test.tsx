// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { MAX_MINOR } from "@/lib/money";
import { fakeRealtime } from "@/test/fake-realtime";

const realtime = vi.hoisted(() => ({ current: null as ReturnType<typeof fakeRealtime> | null }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => realtime.current!.client }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => router }));
import { useLiveFolder } from "./use-live-folder";

const FOLDER = "1f000000-0000-4000-8000-000000000001";
const OTHER = "1f000000-0000-4000-8000-000000000002";
const ITEM = "1d000000-0000-4000-8000-000000000001";
const USER = "1a000000-0000-4000-8000-000000000001";

const row = (over: Record<string, unknown> = {}) => ({
  id: ITEM, folder_id: FOLDER, category_id: "1c000000-0000-4000-8000-000000000001", name: "GPU", currency: "USD", decimal_places: 2, price_minor: 45000,
  created_by: USER, updated_by: USER, created_at: "2026-11-09T10:00:00.123456+00:00", updated_at: "2026-11-09T10:00:00.123456+00:00", ...over,
});
const mapped = {
  id: ITEM, folderId: FOLDER, categoryId: "1c000000-0000-4000-8000-000000000001", name: "GPU", currency: "USD", decimalPlaces: 2, priceMinor: 45000,
  createdBy: USER, createdAt: "2026-11-09T10:00:00.123456+00:00", updatedAt: "2026-11-09T10:00:00.123456+00:00",
};

let visibility: DocumentVisibilityState = "visible";
const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state;
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
};

const handlers = () => ({ onItem: vi.fn(), onMembers: vi.fn(), onLost: vi.fn() });
/** Mounts the hook and lets the session token reach Realtime, after which the channel joins. */
const mount = async (h = handlers(), options: { strict?: boolean } = {}) => {
  const rendered = renderHook(() => useLiveFolder(FOLDER, h), { reactStrictMode: options.strict });
  await act(async () => {});
  return { h, ...rendered };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  realtime.current = fakeRealtime();
  for (const fn of Object.values(router)) fn.mockReset();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("useLiveFolder", () => {
  it("opens one channel with exactly the item and folder filters, even in strict mode, and removes it on unmount", async () => {
    const { unmount } = await mount(handlers(), { strict: true });
    const live = realtime.current!.active();
    expect(live).toHaveLength(1);
    expect(live[0].bindings.filter((binding) => binding.type === "postgres_changes").map((binding) => binding.filter)).toEqual([
      { event: "*", schema: "public", table: "invoice_items", filter: `folder_id=eq.${FOLDER}` },
      // A DELETE carries only the id, so a folder_id filter never matches it (checked on a real stack).
      { event: "DELETE", schema: "public", table: "invoice_items" },
      { event: "*", schema: "public", table: "invoice_folders", filter: `id=eq.${FOLDER}` },
      // Categories added, renamed or deleted by someone else refresh the page.
      { event: "*", schema: "public", table: "invoice_categories", filter: `folder_id=eq.${FOLDER}` },
    ]);
    // Never members, links or tombstones: their DELETE events are not filtered by access.
    expect(realtime.current!.channels.flatMap((channel) => channel.bindings.map((binding) => binding.filter.table)))
      .not.toContain("invoice_members");
    unmount();
    expect(realtime.current!.active()).toHaveLength(0);
  });

  it("starts live and maps item inserts, updates (bigint as string) and deletes into onItem calls", async () => {
    const { h, result } = await mount();
    act(() => realtime.current!.status("SUBSCRIBED"));
    expect(result.current.status).toBe("live");
    const channel = realtime.current!.active()[0];
    act(() => channel.emit("invoice_items", { eventType: "INSERT", new: row(), old: {} }));
    act(() => channel.emit("invoice_items", { eventType: "UPDATE", new: row({ name: "GPU 2", price_minor: String(MAX_MINOR), updated_at: "2026-11-09T11:00:00+00:00" }), old: { id: ITEM } }));
    act(() => channel.emit("invoice_items", { eventType: "DELETE", new: {}, old: { id: ITEM } }));
    expect(h.onItem.mock.calls.map((call) => call[0])).toEqual([
      { type: "upsert", item: mapped },
      { type: "upsert", item: { ...mapped, name: "GPU 2", priceMinor: MAX_MINOR, updatedAt: "2026-11-09T11:00:00+00:00" } },
      { type: "delete", id: ITEM },
    ]);
  });

  it("ignores malformed rows and events for another folder instead of throwing", async () => {
    const { h } = await mount();
    const channel = realtime.current!.active()[0];
    for (const bad of [
      row({ price_minor: "12.5" }), row({ price_minor: 1.5 }), row({ price_minor: "99999999999999999999" }),
      row({ currency: "usd!" }), row({ decimal_places: 9 }), row({ name: 7 }), row({ id: "not-a-uuid" }),
      row({ created_at: null }), row({ folder_id: OTHER }), null,
    ]) act(() => channel.emit("invoice_items", { eventType: "INSERT", new: bad, old: {} }));
    act(() => channel.emit("invoice_items", { eventType: "DELETE", new: {}, old: {} }));
    act(() => channel.emit("invoice_items", { eventType: "DELETE", new: {}, old: { id: 42 } }));
    expect(h.onItem).not.toHaveBeenCalled();
  });

  it("a delete of this folder calls onLost; another folder's delete does not; a rename refreshes the page", async () => {
    const { h } = await mount();
    const channel = realtime.current!.active()[0];
    act(() => channel.emit("invoice_folders", { eventType: "DELETE", new: {}, old: { id: OTHER } }));
    expect(h.onLost).not.toHaveBeenCalled();
    act(() => channel.emit("invoice_folders", { eventType: "UPDATE", new: { id: FOLDER, name: "Gaming PC" }, old: { id: FOLDER } }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    act(() => channel.emit("invoice_folders", { eventType: "DELETE", new: {}, old: { id: FOLDER } }));
    expect(h.onLost).toHaveBeenCalledTimes(1);
  });

  it("refreshes every 30 seconds while visible: router.refresh, then onMembers", async () => {
    const order: string[] = [];
    router.refresh.mockImplementation(() => order.push("refresh"));
    const h = handlers();
    h.onMembers.mockImplementation(() => order.push("members"));
    await mount(h);
    act(() => realtime.current!.status("SUBSCRIBED"));
    // The first SUBSCRIBED catches up once; the timer starts from there.
    expect(order).toEqual(["refresh", "members"]);
    order.length = 0;
    router.refresh.mockClear();
    act(() => { vi.advanceTimersByTime(29_999); });
    expect(router.refresh).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(order).toEqual(["refresh", "members"]);
    setVisibility("hidden");
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("returning to the tab and coming back online each refetch once", async () => {
    const { h } = await mount();
    setVisibility("hidden");
    expect(router.refresh).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(h.onMembers).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(router.refresh).toHaveBeenCalledTimes(2);
    expect(h.onMembers).toHaveBeenCalledTimes(2);
  });

  it("coming back online while the tab is hidden does not refetch", async () => {
    const { h } = await mount();
    setVisibility("hidden");
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(router.refresh).not.toHaveBeenCalled();
    expect(h.onMembers).not.toHaveBeenCalled();
  });

  it("catches up with one refetch on the first SUBSCRIBED, and not again on a repeated one", async () => {
    const { h } = await mount();
    expect(router.refresh).not.toHaveBeenCalled();
    act(() => realtime.current!.status("SUBSCRIBED"));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(h.onMembers).toHaveBeenCalledTimes(1);
    act(() => realtime.current!.status("SUBSCRIBED"));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("catches up once more when a SUBSCRIBED follows polling, on the same channel or a fresh one", async () => {
    await mount();
    act(() => realtime.current!.status("SUBSCRIBED"));
    router.refresh.mockClear();
    act(() => realtime.current!.status("CHANNEL_ERROR"));
    act(() => realtime.current!.status("SUBSCRIBED"));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    router.refresh.mockClear();
    act(() => realtime.current!.status("CLOSED"));
    await act(async () => { vi.advanceTimersByTime(5_000); });
    router.refresh.mockClear();
    act(() => realtime.current!.status("SUBSCRIBED"));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("when the session token cannot be set it polls and retries instead of joining anonymously", async () => {
    realtime.current!.failAuth();
    const { result } = await mount();
    expect(result.current.status).toBe("polling");
    expect(realtime.current!.order).toEqual(["auth"]);
    expect(realtime.current!.channels).toHaveLength(0);
    realtime.current!.failAuth(null);
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(realtime.current!.order).toEqual(["auth", "auth", "join"]);
    expect(realtime.current!.active()).toHaveLength(1);
  });

  it("a channel error switches to polling every 5 seconds only while visible, and back to live on re-subscribe", async () => {
    const { result } = await mount();
    act(() => realtime.current!.status("SUBSCRIBED"));
    router.refresh.mockClear();
    act(() => realtime.current!.status("CHANNEL_ERROR"));
    expect(result.current.status).toBe("polling");
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(router.refresh).toHaveBeenCalledTimes(3);
    setVisibility("hidden");
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(router.refresh).toHaveBeenCalledTimes(3);
    setVisibility("visible");
    expect(router.refresh).toHaveBeenCalledTimes(4);
    // realtime-js rejoins by itself after an error; the same channel reports SUBSCRIBED again.
    act(() => realtime.current!.status("SUBSCRIBED"));
    expect(result.current.status).toBe("live");
    router.refresh.mockReset();
    act(() => { vi.advanceTimersByTime(29_999); });
    expect(router.refresh).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("sets the viewer's session token on Realtime before joining, so the join is not anonymous", async () => {
    await mount();
    // Joined without it, the server checks the filters as an anonymous visitor and rejects them.
    expect(realtime.current!.order).toEqual(["auth", "join"]);
  });

  it("a server notice that postgres changes failed polls, then rejoins on a fresh channel", async () => {
    const { result } = await mount();
    act(() => realtime.current!.status("SUBSCRIBED"));
    const first = realtime.current!.active()[0];
    act(() => first.system({ extension: "postgres_changes", status: "ok", message: "Subscribed to PostgreSQL" }));
    expect(result.current.status).toBe("live");
    act(() => first.system({ extension: "postgres_changes", status: "error", message: "Unable to subscribe to changes with given parameters" }));
    expect(result.current.status).toBe("polling");
    expect(first.removed).toBe(true);
    await act(async () => { vi.advanceTimersByTime(5_000); });
    const [next] = realtime.current!.active();
    expect(next).toBeDefined();
    expect(next).not.toBe(first);
    expect(realtime.current!.order).toEqual(["auth", "join", "auth", "join"]);
  });

  it("preview mode without a database opens no channel but still refreshes", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    await mount();
    expect(realtime.current!.channels).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("a timed-out join also polls", async () => {
    const { result } = await mount();
    act(() => realtime.current!.status("TIMED_OUT"));
    expect(result.current.status).toBe("polling");
  });

  it("a channel the server closed polls, then opens a fresh channel and returns to live when it subscribes", async () => {
    const { result } = await mount();
    act(() => realtime.current!.status("SUBSCRIBED"));
    const first = realtime.current!.active()[0];
    act(() => realtime.current!.status("CLOSED"));
    expect(result.current.status).toBe("polling");
    await act(async () => { vi.advanceTimersByTime(5_000); });
    const live = realtime.current!.active();
    expect(live).toHaveLength(1);
    expect(live[0]).not.toBe(first);
    act(() => realtime.current!.status("SUBSCRIBED"));
    expect(result.current.status).toBe("live");
  });

  it("unmount clears every timer and listener and ignores late events", async () => {
    const { h, unmount } = await mount();
    const channel = realtime.current!.active()[0];
    unmount();
    act(() => { vi.advanceTimersByTime(120_000); });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("online")); });
    act(() => channel.emit("invoice_items", { eventType: "INSERT", new: row(), old: {} }));
    act(() => channel.callback?.("CHANNEL_ERROR"));
    expect(router.refresh).not.toHaveBeenCalled();
    expect(h.onItem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
