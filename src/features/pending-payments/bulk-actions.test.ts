import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/action", () => ({ actionClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { deletePendingPayments } from "./bulk-actions";

const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const items = [{ id: a, revision: 1 }, { id: b, revision: 3 }];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ userId: a, supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

it("deletes several unpaid jobs through one RPC", async () => {
  expect(await deletePendingPayments(items)).toEqual({ ok: true });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("delete_pending_payments", { p_items: items });
  expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/", "layout");
});

it("rejects empty, repeated and malformed batches before touching the database", async () => {
  expect(await deletePendingPayments([])).toEqual({ ok: false, error: "invalid" });
  expect(await deletePendingPayments([items[0], items[0]])).toEqual({ ok: false, error: "invalid" });
  expect(await deletePendingPayments([{ id: a, revision: 0 }])).toEqual({ ok: false, error: "invalid" });
  expect(await deletePendingPayments([{ id: a, revision: 1, totalMinor: 1 } as never])).toEqual({ ok: false, error: "invalid" });
  expect(mocks.client).not.toHaveBeenCalled();
});

it("maps the refusal of the whole batch to a stable code", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "pending.inUse" } });
  expect(await deletePendingPayments(items)).toEqual({ ok: false, error: "inUse" });
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "pending.conflict" } });
  expect(await deletePendingPayments(items)).toEqual({ ok: false, error: "conflict" });
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "relation secret_table does not exist" } });
  expect(await deletePendingPayments(items)).toEqual({ ok: false, error: "failed" });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
