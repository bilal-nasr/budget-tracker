import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), ctx: vi.fn(), invalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.invalidate }));
vi.mock("@/lib/supabase/action", () => ({ actionClient: mocks.ctx }));
vi.mock("@/features/profile/queries", () => ({ getProfile: async () => ({ timezone: "Asia/Beirut" }) }));
import { createPendingPayment, recordPendingReceipt, updatePendingPayment, deletePendingPayment } from "./actions";
const id = "ab000000-0000-4000-8000-000000000001";
const job = { requestId: id, client: "Client", project: "Website", currency: "USD" as const, totalMinor: 10000, dueOn: null };
const receipt = { requestId: id, paymentId: id, walletId: id, categoryId: id, amountMinor: 2500, occurredOn: "2026-01-01" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ctx.mockResolvedValue({ supabase: { rpc: mocks.rpc }, userId: id });
  mocks.rpc.mockResolvedValue({ data: [{ id }], error: null });
});
describe("pending payment actions", () => {
  it("validates before database access", async () => {
    expect(await createPendingPayment({ ...job, totalMinor: 0 })).toEqual({ ok: false, error: "invalid" });
    expect(await recordPendingReceipt({ ...receipt, occurredOn: "2099-01-01" })).toEqual({ ok: false, error: "invalid" });
    expect(await updatePendingPayment(id, 0, job)).toEqual({ ok: false, error: "invalid" });
    expect(await deletePendingPayment("bad", 1)).toEqual({ ok: false, error: "invalid" });
    expect(mocks.ctx).not.toHaveBeenCalled();
  });
  it("preserves retry identities and invalidates after the atomic write", async () => {
    expect(await recordPendingReceipt(receipt)).toEqual({ ok: true, id });
    expect(mocks.rpc).toHaveBeenCalledWith("record_pending_receipt", { p_input: receipt });
    expect(mocks.invalidate).toHaveBeenCalledWith("/", "layout");
  });
  it("maps cap errors and protects database details", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "pending.exceedsRemaining" } });
    expect(await recordPendingReceipt(receipt)).toEqual({ ok: false, error: "exceedsRemaining" });
    mocks.rpc.mockResolvedValue({ error: { message: "internal sensitive details" } });
    expect(await createPendingPayment(job)).toEqual({ ok: false, error: "failed" });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
  it("handles preview mode and uncertain transport outcomes", async () => {
    mocks.ctx.mockResolvedValueOnce({ error: "notConfigured" });
    expect(await createPendingPayment(job)).toEqual({ ok: false, error: "notConfigured" });
    mocks.rpc.mockRejectedValueOnce(new Error("network"));
    expect(await recordPendingReceipt(receipt)).toEqual({ ok: false, error: "failed" });
  });
  it("rejects malformed successful responses", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: "bad" }], error: null });
    expect(await createPendingPayment(job)).toEqual({ ok: false, error: "failed" });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
