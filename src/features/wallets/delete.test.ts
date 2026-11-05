import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), ctx: vi.fn(), invalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.invalidate }));
vi.mock("@/lib/supabase/action", async (original) => ({
  ...await original<typeof import("@/lib/supabase/action")>(),
  actionClient: mocks.ctx,
}));
vi.mock("@/features/profile/queries", () => ({ getProfile: vi.fn() }));
import { deleteWallet } from "./actions";
const id = "aaaaaaaa-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ctx.mockResolvedValue({ userId: id, supabase: { rpc: mocks.rpc, from: mocks.from } });
  mocks.rpc.mockResolvedValue({ error: null });
});
it("deletes through one atomic RPC without clearing salary in a separate request", async () => {
  expect(await deleteWallet(id)).toEqual({ ok: true });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("delete_wallet", { p_id: id });
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.invalidate).toHaveBeenCalledWith("/", "layout");
});
it("maps reference/history errors without partial mutation or raw DB text", async () => {
  for (const [message, error] of [["wallet.inUse", "inUse"], ["wallet.hasTransactions", "hasTransactions"], ["wallet.invalid", "invalid"], ["sensitive backend detail", "failed"]]) {
    mocks.rpc.mockResolvedValue({ error: { message } });
    expect(await deleteWallet(id)).toEqual({ ok: false, error });
  }
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.invalidate).not.toHaveBeenCalled();
});
it("rejects invalid IDs and preserves preview/auth errors", async () => {
  expect(await deleteWallet("bad")).toEqual({ ok: false, error: "invalid" });
  mocks.ctx.mockResolvedValue({ error: "notConfigured" });
  expect(await deleteWallet(id)).toEqual({ ok: false, error: "notConfigured" });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("keeps unknown transport failure in ActionResult and never issues a second write", async () => {
  mocks.rpc.mockRejectedValue(new Error("connection lost"));
  expect(await deleteWallet(id)).toEqual({ ok: false, error: "failed" });
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.invalidate).not.toHaveBeenCalled();
});
