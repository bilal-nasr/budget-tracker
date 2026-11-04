import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/action", () => ({ actionClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("./queries", () => ({ fetchTransactions: vi.fn() }));
vi.mock("server-only", () => ({}));
import { createTransfer } from "./actions";

const from = "00000000-0000-4000-8000-000000000001";
const to = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000003";
const input = { occurredOn: "2026-11-04", fromWalletId: from, toWalletId: to, fromAmountMinor: 1250, toAmountMinor: 200 };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ userId: from, supabase: { rpc: mocks.rpc, from: mocks.from } });
  mocks.rpc.mockResolvedValue({ data: [{ id, revision: 1 }], error: null });
});

describe("createTransfer atomic currency boundary", () => {
  it("records actual amounts through one authenticated RPC, without a profile update", async () => {
    expect(await createTransfer(input)).toEqual({ ok: true, id, revision: 1 });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("record_transfer", {
      p_occurred_on: input.occurredOn, p_from_wallet_id: from, p_to_wallet_id: to,
      p_from_amount_minor: 1250, p_to_amount_minor: 200, p_note: null, p_usd_lbp_rate: null,
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  });
  it("lets the locked database pair check reject forged SYP rate metadata", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "rate is only supported for USD/LBP exchanges" } });
    expect(await createTransfer({ ...input, rate: 89500 })).toEqual({ ok: false, error: "invalid" });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("rejects invalid amounts and identical wallets before touching the database", async () => {
    expect(await createTransfer({ ...input, toWalletId: from })).toEqual({ ok: false, error: "invalid" });
    expect(await createTransfer({ ...input, toAmountMinor: 0 })).toEqual({ ok: false, error: "invalid" });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("preserves demo write errors", async () => {
    mocks.client.mockResolvedValue({ error: "notConfigured" });
    expect(await createTransfer(input)).toEqual({ ok: false, error: "notConfigured" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
