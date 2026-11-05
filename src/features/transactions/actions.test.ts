import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/action", () => ({ actionClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("./queries", () => ({ fetchTransactions: vi.fn() }));
vi.mock("server-only", () => ({}));
import { createTransfer, correctTransactionNote } from "./actions";

const from = "00000000-0000-4000-8000-000000000001";
const to = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000003";
const input = { requestId: id, occurredOn: "2026-11-04", sourceBalanceId: from, destinationBalanceId: to, sentMinor: 1250, receivedMinor: 200 };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ userId: from, supabase: { rpc: mocks.rpc, from: mocks.from } });
  mocks.rpc.mockResolvedValue({ data: [{ id, revision: 1 }], error: null });
});

describe("createTransfer atomic currency boundary", () => {
  it("allows only a revision-checked historical note correction and rejects forged monetary fields", async () => {
    expect(await correctTransactionNote(id, 2, { note: "History", amountMinor: 5 } as never)).toEqual({ ok: false, error: "invalid" });
    expect(mocks.client).not.toHaveBeenCalled();
    const query = Object.fromEntries(["update", "eq", "is", "select"].map((method) => [method, vi.fn().mockReturnThis()]));
    query.maybeSingle = vi.fn().mockResolvedValue({ data: { id, revision: 3 }, error: null });
    mocks.from.mockReturnValue(query);
    expect(await correctTransactionNote(id, 2, { note: " History " })).toEqual({ ok: true, id, revision: 3 });
    expect(query.update).toHaveBeenCalledExactlyOnceWith({ note: "History" });
    expect(query.eq).toHaveBeenCalledWith("user_id", from);
    expect(query.eq).toHaveBeenCalledWith("revision", 2);
    expect(query.is).toHaveBeenCalledWith("deleted_at", null);
    mocks.revalidate.mockClear();
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await correctTransactionNote(id, 2, { note: "Stale" })).toEqual({ ok: false, error: "conflict" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("records actual amounts through one authenticated RPC, without a profile update", async () => {
    expect(await createTransfer(input)).toEqual({ ok: true, id, revision: 1 });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("record_balance_transfer", {
      p_request_id: id, p_occurred_on: input.occurredOn, p_from_balance_id: from, p_to_balance_id: to,
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
    expect(await createTransfer({ ...input, destinationBalanceId: from })).toEqual({ ok: false, error: "invalid" });
    expect(await createTransfer({ ...input, receivedMinor: 0 })).toEqual({ ok: false, error: "invalid" });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("preserves demo write errors", async () => {
    mocks.client.mockResolvedValue({ error: "notConfigured" });
    expect(await createTransfer(input)).toEqual({ ok: false, error: "notConfigured" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

it("binds transfer retries to the caller request id and denomination snapshot", async () => {
  const request = { ...input, requestId: id, expectedUnits: { USD: 2, TOKEN8: 8 } };
  await createTransfer(request);
  expect(mocks.client).toHaveBeenCalledWith(request.expectedUnits);
  expect(mocks.rpc).toHaveBeenCalledWith("record_balance_transfer", expect.objectContaining({ p_request_id: id }));
});
