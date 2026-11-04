import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actionClient: vi.fn(), revalidatePath: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/action", () => ({ actionClient: mocks.actionClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
import { payInstallmentForCycle, receiveSalaryForCycle } from "./cycle-actions";

const requestId = "a1000000-0000-4000-8000-000000000001";
const installmentId = "a2000000-0000-4000-8000-000000000001";
const walletId = "a3000000-0000-4000-8000-000000000001";
const receiptId = "a4000000-0000-4000-8000-000000000001";
const payment = { requestId, installmentId, walletId, amountMinor: 4000, occurredOn: "2026-10-31", salaryCycleId: receiptId, overrideOfTransactionId: null };
const salary = { requestId, expectedCycleId: receiptId };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actionClient.mockResolvedValue({ supabase: { rpc: mocks.rpc }, userId: "owner" });
  mocks.rpc.mockResolvedValue({ data: [{ id: requestId, revision: 1 }], error: null });
});

describe("source-specific cycle actions", () => {
  it("validates before auth/database access and rejects forged salary configuration", async () => {
    expect(await receiveSalaryForCycle({ ...salary, requestId: "bad" })).toEqual({ ok: false, error: "invalid" });
    expect(await receiveSalaryForCycle({ ...salary, amountMinor: 123 } as typeof salary)).toEqual({ ok: false, error: "invalid" });
    expect(await payInstallmentForCycle({ ...payment, occurredOn: "2026-02-30" })).toEqual({ ok: false, error: "invalid" });
    expect(mocks.actionClient).not.toHaveBeenCalled();
  });
  it.each(["notConfigured", "failed"])("preserves preview/session error %s without writing", async (error) => {
    mocks.actionClient.mockResolvedValue({ error });
    expect(await receiveSalaryForCycle(salary)).toEqual({ ok: false, error });
    expect(await payInstallmentForCycle(payment)).toEqual({ ok: false, error });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it("forwards the stable salary UUID and expected receipt, deriving no salary money from the client", async () => {
    expect(await receiveSalaryForCycle(salary)).toEqual({ ok: true, id: requestId, revision: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith("receive_salary", { p_request_id: requestId, p_expected_cycle_id: receiptId });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });
  it("treats uppercase UUID input as the same PostgreSQL identity when validating the returned row", async () => {
    expect(await receiveSalaryForCycle({ requestId: requestId.toUpperCase(), expectedCycleId: receiptId.toUpperCase() }))
      .toEqual({ ok: true, id: requestId, revision: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith("receive_salary", { p_request_id: requestId, p_expected_cycle_id: receiptId });
  });
  it("forwards the exact expense intent and confirmed acknowledgment without reading then inserting", async () => {
    const extra = { ...payment, overrideOfTransactionId: "a5000000-0000-4000-8000-000000000001" };
    expect(await payInstallmentForCycle(extra)).toEqual({ ok: true, id: requestId, revision: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith("record_installment_payment", {
      p_request_id: requestId, p_installment_id: installmentId, p_wallet_id: walletId, p_amount_minor: 4000,
      p_occurred_on: "2026-10-31", p_salary_cycle_id: receiptId, p_override_of_transaction_id: extra.overrideOfTransactionId,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });
  it("preserves null initial cycle and one request identity across an unknown-outcome retry", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("private transport diagnostics"));
    const input = { ...payment, salaryCycleId: null };
    expect(await payInstallmentForCycle(input)).toEqual({ ok: false, error: "failed" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(await payInstallmentForCycle(input)).toEqual({ ok: true, id: requestId, revision: 1 });
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
  });
  it.each([
    ["already paid this cycle", "alreadyPaidThisCycle"], ["salary cycle changed", "cycleChanged"],
    ["installment payment changed", "paymentChanged"], ["transaction request already used", "requestAlreadyUsed"],
    ["exceeds remaining", "exceedsRemaining"], ["wallet not found or archived", "walletUnavailable"],
    ["salary wallet not found or archived", "walletUnavailable"], ["salary category not found", "categoryUnavailable"],
    ["salary not configured", "invalid"], ["invalid installment date", "invalid"],
  ])("maps known rule %s to %s without revalidating", async (message, error) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } });
    expect(await payInstallmentForCycle(payment)).toEqual({ ok: false, error });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it("hides unexpected database/session details and maps canonical conflicts", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "BT003", message: "transaction conflict" } });
    expect(await receiveSalaryForCycle(salary)).toEqual({ ok: false, error: "conflict" });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "private relation/account data" } });
    expect(await receiveSalaryForCycle(salary)).toEqual({ ok: false, error: "failed" });
    mocks.actionClient.mockRejectedValueOnce(new Error("private session diagnostics"));
    expect(await receiveSalaryForCycle(salary)).toEqual({ ok: false, error: "failed" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it.each([null, [], [{ id: requestId, revision: 0 }], [{ id: requestId, revision: 1.5 }],
    [{ id: requestId, revision: 1 }, { id: requestId, revision: 1 }], [{ id: receiptId, revision: 1 }]])("fails closed on an invalid RPC mutation result %j", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect(await payInstallmentForCycle(payment)).toEqual({ ok: false, error: "failed" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
