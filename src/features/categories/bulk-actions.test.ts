import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/action", () => ({ actionClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { removeCategories } from "./bulk-actions";

const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ userId: a, supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: [{ id: a, outcome: "deleted" }, { id: b, outcome: "archived" }], error: null });
});

it("removes several categories through one RPC and counts the outcomes", async () => {
  expect(await removeCategories([a, b])).toEqual({ ok: true, deleted: 1, archived: 1 });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("remove_categories", { p_ids: [a, b] });
  expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/", "layout");
});

it("rejects empty, repeated and malformed lists before touching the database", async () => {
  expect(await removeCategories([])).toEqual({ ok: false, error: "invalid" });
  expect(await removeCategories([a, a])).toEqual({ ok: false, error: "invalid" });
  expect(await removeCategories(["nope"])).toEqual({ ok: false, error: "invalid" });
  expect(mocks.client).not.toHaveBeenCalled();
});

it("names the category that blocks the batch, and only if it was in the request", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "category_in_use", details: b } });
  expect(await removeCategories([a, b])).toEqual({ ok: false, error: "inUse", blockedId: b });
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "category_in_use", details: "00000000-0000-4000-8000-000000000099" } });
  expect(await removeCategories([a, b])).toEqual({ ok: false, error: "inUse" });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});

it("never passes database text through and distrusts an unexpected result", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation secret_table does not exist" } });
  expect(await removeCategories([a, b])).toEqual({ ok: false, error: "failed" });
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "category_not_found" } });
  expect(await removeCategories([a, b])).toEqual({ ok: false, error: "invalid" });
  mocks.rpc.mockResolvedValue({ data: [{ id: a, outcome: "deleted" }], error: null });
  expect(await removeCategories([a, b])).toEqual({ ok: false, error: "failed" });
  mocks.client.mockResolvedValue({ error: "notConfigured" });
  expect(await removeCategories([a, b])).toEqual({ ok: false, error: "notConfigured" });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
