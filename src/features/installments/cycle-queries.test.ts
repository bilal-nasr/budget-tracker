import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), createClient: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { getCycleSnapshot, parseCycleSnapshot, parseCycleSummary } from "./cycle-queries";

const itemId = "a1000000-0000-4000-8000-000000000001";
const walletId = "a2000000-0000-4000-8000-000000000001";
const categoryId = "a3000000-0000-4000-8000-000000000001";
const receiptId = "a4000000-0000-4000-8000-000000000001";
const payId = "a5000000-0000-4000-8000-000000000001";
const oldId = "a5000000-0000-4000-8000-000000000002";
const storedItem = { id: itemId, name: "Synthetic laptop", currency: "USD", wallet_id: walletId, category_id: categoryId,
  total_minor: "100000", paid_before_minor: "20000", monthly_minor: "10000", due_day: 15, position: 1 };
const currentPayment = { id: payId, installment_id: itemId, wallet_id: walletId, amount_minor: "4000", occurred_on: "2026-09-01",
  created_at: "2026-11-04T10:00:00.000002+00:00", salary_cycle_id: receiptId, revision: 1,
  kind: "expense", currency: "USD", category_id: categoryId, note: "Synthetic payment name", deleted_at: null,
  to_wallet_id: null, to_amount_minor: null, source: "installment", fixed_expense_id: null, loan_id: null, loan_flow: null,
  tender_minor: null, change_wallet_id: null, change_minor: null, change_currency: null,
  change_rate_base: null, change_rate_quote: null, change_rate_numerator: null, change_rate_denominator: null,
  expense_items: [] as { id: string; description: string; amount_minor: number | string; position: number }[] };
const data = () => ({
  receipt: { id: receiptId, occurred_on: "2026-11-04", created_at: "2026-11-04T08:00:00.000001+00:00", revision: 1 },
  installments: [{ ...storedItem }],
  payments: [
    { ...currentPayment },
    { ...currentPayment, id: oldId, amount_minor: 10000, salary_cycle_id: null, occurred_on: "2026-11-03", created_at: "2026-11-03T10:00:00+00:00" },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: data(), error: null });
});

describe("coherent installment snapshot", () => {
  it("decodes a compact summary with the same progress without retaining historical transactions", () => {
    const input = data();
    const summary = { receipt: input.receipt, installments: [{ ...storedItem,
      paid_minor: "34000", remaining_minor: "66000", paid_this_cycle_minor: "4000",
      cycle_payment_count: 1, cycle_latest_payment_id: payId,
    }] };
    const actual = parseCycleSummary(summary);
    const full = parseCycleSnapshot(input);
    expect(actual.receipt).toEqual(full.receipt);
    expect(actual.installments[0]).toEqual({ ...full.installments[0], payments: [], historyComplete: false });
    for (const invalid of [
      { remaining_minor: "65999" }, { paid_this_cycle_minor: "100001" },
      { cycle_payment_count: 0 }, { cycle_latest_payment_id: null }, { paid_minor: "100001" },
    ]) expect(() => parseCycleSummary({ ...summary, installments: [{ ...summary.installments[0], ...invalid }] })).toThrow("installment_cycle_snapshot_unavailable");
  });
  it("maps the single RPC snapshot with exact money, receipt identity, revisions, and microseconds", async () => {
    const result = await getCycleSnapshot();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("installment_cycle_snapshot");
    expect(result.receipt).toEqual({ id: receiptId, occurredOn: "2026-11-04", createdAt: "2026-11-04T08:00:00.000001+00:00" });
    expect(result.installments[0]).toMatchObject({
      id: itemId, currency: "USD", paidMinor: 34000, remainingMinor: 66000, paidThisCycleMinor: 4000,
      salaryCycleId: receiptId, cyclePaymentCount: 1, cycleLatestPaymentId: payId, cycleStatus: "partial",
    });
    expect(result.installments[0].payments[0]).toMatchObject({ transactionId: payId, revision: 1, amountMinor: 4000,
      occurredOn: "2026-09-01", createdAt: "2026-11-04T10:00:00.000002+00:00", salaryCycleId: receiptId });
  });
  it("keeps null initial receipt distinct from a failed/missing receipt response", () => {
    const input = data();
    const result = parseCycleSnapshot({ ...input, receipt: null });
    expect(result.receipt).toBeNull();
    expect(result.installments[0]).toMatchObject({ paidThisCycleMinor: 10000, cycleLatestPaymentId: oldId, cycleStatus: "paid" });
    expect(() => parseCycleSnapshot({ installments: input.installments, payments: input.payments })).toThrow("installment_cycle_snapshot_unavailable");
  });
  it("preserves the complete real parent for history Edit: name, revision, source, and ordered items", () => {
    const input = data();
    const line1 = { id: "b1000000-0000-4000-8000-000000000001", description: "First part", amount_minor: "1500", position: 0 };
    const line2 = { id: "b1000000-0000-4000-8000-000000000002", description: "Second part", amount_minor: "2000", position: 1 };
    const result = parseCycleSnapshot({ ...input, payments: [{ ...currentPayment, revision: 6, expense_items: [line2, line1] }] });
    const payment = result.installments[0].payments[0];
    expect(payment.revision).toBe(6);
    expect(payment.transaction).toMatchObject({
      id: payId, kind: "expense", note: "Synthetic payment name", revision: 6, source: "installment", installmentId: itemId,
      amountMinor: 4000, currency: "USD", categoryId, walletId, loanId: null, loanFlow: null, fixedExpenseId: null,
      toWalletId: null, toAmountMinor: null,
      items: [
        { id: line1.id, description: "First part", amountMinor: 1500, position: 0 },
        { id: line2.id, description: "Second part", amountMinor: 2000, position: 1 },
      ],
    });
    expect(result.installments[0]).toMatchObject({ paidMinor: 24000, remainingMinor: 76000, paidThisCycleMinor: 4000 });
  });
  it("supports an actually empty catalogue without fabricating payments or a salary", () => {
    expect(parseCycleSnapshot({ receipt: null, installments: [], payments: [] })).toEqual({ receipt: null, installments: [] });
  });
  it("preserves SYP minor units and null monthly/due fields", () => {
    const input = data();
    const result = parseCycleSnapshot({ ...input,
      installments: [{ ...storedItem, currency: "SYP", monthly_minor: null, due_day: null }],
      payments: input.payments.map((payment) => ({ ...payment, currency: "SYP" })),
    });
    expect(result.installments[0]).toMatchObject({ currency: "SYP", monthlyMinor: null, dueDay: null, remainingMinor: 66000, cycleStatus: "paid" });
  });
  it.each(["9007199254740993", 9007199254740992, "1000000000000001", "1.5", "NaN", "", -1, 0])("rejects invalid/unsafe payment money %s before Number rounding", (amount_minor) => {
    const input = data();
    expect(() => parseCycleSnapshot({ ...input, payments: [{ ...currentPayment, amount_minor }] })).toThrow("installment_cycle_snapshot_unavailable");
  });
  it("rejects overpaid or duplicated facts instead of showing a false paid/unpaid balance", () => {
    const input = data();
    for (const invalid of [
      { ...input, payments: [{ ...currentPayment, amount_minor: 100001 }] },
      { ...input, payments: [currentPayment, currentPayment] },
      { ...input, installments: [storedItem, storedItem] },
      { ...input, payments: [{ ...currentPayment, installment_id: receiptId }] },
      { ...input, payments: null },
      { ...input, payments: [{ ...currentPayment, salary_cycle_id: "bad" }] },
      { ...input, payments: [{ ...currentPayment, revision: 0 }] },
      { ...input, receipt: { ...input.receipt, created_at: "bad" } },
    ]) expect(() => parseCycleSnapshot(invalid)).toThrow("installment_cycle_snapshot_unavailable");
  });
  it("rejects incomplete/unsafe item history instead of supplying an empty editor snapshot", () => {
    const input = data();
    const missingItems: Record<string, unknown> = { ...currentPayment };
    delete missingItems.expense_items;
    const line = { id: "b1000000-0000-4000-8000-000000000001", description: "One part", amount_minor: 1000, position: 0 };
    for (const payment of [
      missingItems,
      { ...currentPayment, note: undefined },
      { ...currentPayment, expense_items: null },
      { ...currentPayment, expense_items: [{ ...line, amount_minor: "9007199254740993" }] },
      { ...currentPayment, expense_items: [{ ...line, amount_minor: 4001 }] },
      { ...currentPayment, expense_items: [line, line] },
      { ...currentPayment, currency: "LBP" },
      { ...currentPayment, kind: "income" },
    ]) expect(() => parseCycleSnapshot({ ...input, payments: [payment] })).toThrow("installment_cycle_snapshot_unavailable");
  });
  it("does not leak database errors, silently return [], or run fallback payment queries", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "private missing migration/relation" } });
    await expect(getCycleSnapshot()).rejects.toThrow("installment_cycle_snapshot_unavailable");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    mocks.rpc.mockRejectedValueOnce(new Error("private transport details"));
    await expect(getCycleSnapshot()).rejects.toThrow("installment_cycle_snapshot_unavailable");
  });
  it("rejects malformed successful payloads through the safe read error", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { receipt: null }, error: null });
    await expect(getCycleSnapshot()).rejects.toThrow("installment_cycle_snapshot_unavailable");
  });
  it("returns coherent read-only synthetic demo cycles without a session/client", async () => {
    mocks.configured.mockReturnValue(false);
    const snapshot = await getCycleSnapshot("Asia/Beirut");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(snapshot.receipt?.id).toBeTruthy();
    expect(snapshot.installments.find((i) => i.name === "Laptop")).toMatchObject({ remainingMinor: 90000, paidThisCycleMinor: 10000, cycleStatus: "paid", cyclePaymentCount: 1 });
    expect(snapshot.installments.find((i) => i.name === "Laptop")?.payments[0].transaction).toMatchObject({
      note: "Laptop payment", source: "installment", revision: 3, items: [expect.objectContaining({ description: "Device installment", amountMinor: 7000 }),expect.objectContaining({ description: "Accessories installment", amountMinor: 3000 })],
    });
    expect(snapshot.installments.find((i) => i.name === "Fridge")?.cycleStatus).toBe("paidOff");
  });
});
