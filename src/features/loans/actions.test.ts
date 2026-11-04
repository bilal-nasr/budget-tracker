import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), ctx: vi.fn(), invalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.invalidate }));
vi.mock("@/lib/supabase/action", () => ({ actionClient: mocks.ctx }));
vi.mock("@/features/profile/queries", () => ({ getProfile: async () => ({ timezone: "Asia/Beirut" }) }));
import { cancelLoan, createLoan, deleteLoan, deleteLoanPayment, recordLoanPayment, restoreLoanPayment, setLoanArchived, updateLoan, voidLoanPayment } from "./actions";

const id = "aaaaaaaa-0000-4000-8000-000000000001";
const input = { requestId: id, name: "Loan", direction: "borrowed" as const, principalMinor: 10000, feeBps: 500,
  walletId: id, feeCategoryId: id, openedOn: "2026-01-01", creationMode: "new" as const, principalPaidBeforeMinor: 0, feePaidBeforeMinor: 0 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ctx.mockResolvedValue({ userId: id, supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: [{ id, revision: 1 }], error: null });
});
describe("loan action boundary", () => {
  it("validates permanent deletion and delegates to atomic lifecycle RPCs", async () => {
    expect(await deleteLoan("bad")).toEqual({ ok: false, error: "invalid" });
    expect(await deleteLoanPayment(id, 0)).toEqual({ ok: false, error: "invalid" });
    expect(await deleteLoanPayment("bad", 1)).toEqual({ ok: false, error: "invalid" });
    expect(mocks.ctx).not.toHaveBeenCalled();
    expect(await deleteLoan(id)).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith("delete_loan", { p_id: id });
    expect(await deleteLoanPayment(id, 3)).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith("delete_loan_payment", { p_transaction_id: id, p_expected_revision: 3 });
    expect(mocks.invalidate).toHaveBeenCalledTimes(2);
  });
  it("does not invalidate after rejected permanent deletion", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "loan.inUse" } });
    expect(await deleteLoan(id)).toEqual({ ok: false, error: "inUse" });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
  it("rejects bad terms before contacting the database", async () => {
    expect(await createLoan({ ...input, principalMinor: 0 })).toEqual({ ok: false, error: "invalid" });
    expect(mocks.ctx).not.toHaveBeenCalled();
  });
  it("preserves the configured preview/auth boundary", async () => {
    mocks.ctx.mockResolvedValue({ error: "notConfigured" });
    expect(await createLoan(input)).toEqual({ ok: false, error: "notConfigured" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses one atomic RPC and invalidates only after success", async () => {
    expect(await createLoan(input)).toEqual({ ok: true, id });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("create_loan", { p_input: input });
    expect(mocks.invalidate).toHaveBeenCalledWith("/", "layout");
  });
  it("maps stable DB errors without exposing raw database detail", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "loan.exceedsRemaining", details: "private" } });
    expect(await recordLoanPayment({ requestId: id, loanId: id, walletId: id, amountMinor: 1, occurredOn: "2026-01-01" })).toEqual({ ok: false, error: "exceedsRemaining" });
    expect(mocks.invalidate).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ error: { message: "sensitive unknown error" } });
    expect(await cancelLoan(id)).toEqual({ ok: false, error: "failed" });
  });
  it("rejects future dates and missing create results", async () => {
    expect(await createLoan({ ...input, openedOn: "2099-01-01" })).toEqual({ ok: false, error: "invalid" });
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await createLoan(input)).toEqual({ ok: false, error: "failed" });
  });
  it("uses controlled lifecycle RPCs and rejects invalid IDs", async () => {
    expect(await voidLoanPayment("bad", 1)).toEqual({ ok: false, error: "invalid" });
    expect(await voidLoanPayment(id, 0)).toEqual({ ok: false, error: "invalid" });
    await voidLoanPayment(id, 1); await restoreLoanPayment(id, 2); await cancelLoan(id);
    await setLoanArchived(id, true); await updateLoan(id, { name: "Friend", walletId: id, feeCategoryId: id });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["void_loan_payment", "restore_loan_payment", "cancel_loan", "set_loan_archived", "update_loan"]);
    expect(mocks.rpc.mock.calls[0][1]).toEqual({ p_transaction_id: id, p_expected_revision: 1 });
    expect(mocks.rpc.mock.calls[1][1]).toEqual({ p_transaction_id: id, p_expected_revision: 2 });
  });
  it("handles an unknown payment transport outcome without changing the request identity", async () => {
    const payment = { requestId: id, loanId: id, walletId: id, amountMinor: 100, occurredOn: "2026-01-01" };
    mocks.rpc.mockRejectedValue(new Error("connection lost"));
    expect(await recordLoanPayment(payment)).toEqual({ ok: false, error: "failed" });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("record_loan_payment", { p_input: payment });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
