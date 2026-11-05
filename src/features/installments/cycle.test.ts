import { describe, expect, it } from "vitest";
import {
  canPayNormally,
  dueThisCycle,
  paymentAmountDefault,
  withProgress,
  type InstallmentBase,
  type InstallmentPayment,
} from "./cycle";

const base: InstallmentBase = {
  id: "laptop", name: "Laptop", currency: "USD", balanceId: "bank", categoryId: "shopping",
  totalMinor: 120000, paidBeforeMinor: 0, monthlyMinor: 10000, dueDay: 15,
};
const pay = (
  transactionId: string, amountMinor: number, salaryCycleId: string | null,
  occurredOn = "2026-11-01", createdAt = "2026-11-01T12:00:00.000000Z",
): InstallmentPayment => ({ transactionId, amountMinor, salaryCycleId, occurredOn, createdAt, balanceId: "bank", revision: 1 });

describe("actual salary receipt cycles", () => {
  it("keeps an old-calendar-month payment paid until another receipt, without resetting principal", () => {
    const payments = [pay("p1", 10000, "salary-1", "2026-10-31")];
    const current = withProgress(base, payments, "salary-1");
    expect(current).toMatchObject({ paidMinor: 10000, remainingMinor: 110000, paidThisCycleMinor: 10000, cycleStatus: "paid", cyclePaymentCount: 1 });
    expect(canPayNormally(current)).toBe(false);
    const next = withProgress(base, payments, "salary-2");
    expect(next).toMatchObject({ paidMinor: 10000, remainingMinor: 110000, paidThisCycleMinor: 0, cycleStatus: "unpaid" });
    expect(canPayNormally(next)).toBe(true);
  });

  it("separates two receipts on the same day and ignores a payment's backdated accounting date", () => {
    const current = withProgress(base, [pay("p1", 10000, "morning"), pay("p2", 4000, "evening", "2026-09-01")], "evening");
    expect(current).toMatchObject({ paidMinor: 14000, paidThisCycleMinor: 4000, cyclePaymentCount: 1, cycleStatus: "partial" });
  });

  it("treats null as the initial cycle and does not treat pre-app principal as a payment", () => {
    const initial = withProgress({ ...base, paidBeforeMinor: 20000 }, [pay("p0", 4000, null)], null);
    expect(initial).toMatchObject({ paidMinor: 24000, remainingMinor: 96000, paidThisCycleMinor: 4000, cycleStatus: "partial" });
    expect(canPayNormally(initial)).toBe(false);
    expect(withProgress({ ...base, paidBeforeMinor: 20000 }, [], null).cycleStatus).toBe("unpaid");
    expect(withProgress(base, initial.payments, "first-salary").paidThisCycleMinor).toBe(0);
  });

  it("counts partial and repeat payments once, with no future-cycle credit", () => {
    const payments = [pay("old", 20000, "old"), pay("part", 4000, "s1")];
    const partial = withProgress(base, payments, "s1");
    expect(partial).toMatchObject({ paidMinor: 24000, remainingMinor: 96000, cycleStatus: "partial" });
    expect(paymentAmountDefault(partial)).toBe(6000);
    const full = withProgress(base, [...payments, pay("topup", 6000, "s1")], "s1");
    expect(full).toMatchObject({ paidMinor: 30000, remainingMinor: 90000, paidThisCycleMinor: 10000, cyclePaymentCount: 2, cycleStatus: "paid" });
    const extra = withProgress(base, [...full.payments, pay("extra", 15000, "s1")], "s1");
    expect(extra.remainingMinor).toBe(75000);
    expect(dueThisCycle(extra)).toBe(10000);
    expect(paymentAmountDefault(extra)).toBe(10000);
    const next = withProgress(base, extra.payments, "s2");
    expect(next.paidThisCycleMinor).toBe(0);
    expect(dueThisCycle(next)).toBe(10000);
  });

  it("keeps a final small payment in this cycle's planned total, and paid-off takes precedence", () => {
    const finalBase = { ...base, totalMinor: 25000, paidBeforeMinor: 20000 };
    const before = withProgress(finalBase, [], "s1");
    expect(dueThisCycle(before)).toBe(5000);
    expect(paymentAmountDefault(before)).toBe(5000);
    const paid = withProgress(finalBase, [pay("final", 5000, "s1")], "s1");
    expect(paid.cycleStatus).toBe("paidOff");
    expect(canPayNormally(paid)).toBe(false);
    expect(paymentAmountDefault(paid)).toBe(0);
    expect(dueThisCycle(paid)).toBe(5000);
    expect(dueThisCycle(withProgress(finalBase, paid.payments, "s2"))).toBe(0);
  });

  it("records payments without a monthly target without inventing a scheduled amount", () => {
    const unplanned = withProgress({ ...base, monthlyMinor: null }, [], null);
    expect(dueThisCycle(unplanned)).toBe(0);
    expect(paymentAmountDefault(unplanned)).toBe(120000);
    expect(withProgress({ ...base, monthlyMinor: null }, [pay("one", 1, null)], null).cycleStatus).toBe("paid");
  });

  it("selects the last live acknowledgment anchor by precise recording time, never accounting date", () => {
    const current = withProgress(base, [
      pay("z", 100, "s1", "2026-11-04", "2026-11-01T12:00:00.000001Z"),
      pay("a", 100, "s1", "2026-10-04", "2026-11-01T12:00:00.000002Z"),
      pay("zz", 100, "s0", "2026-11-04", "2026-11-01T12:00:00.000003Z"),
    ], "s1");
    expect(current.cycleLatestPaymentId).toBe("a");
    expect(current.payments.map((p) => p.transactionId)).toEqual(["zz", "a", "z"]);
    expect(withProgress(base, [pay("a", 1, null), pay("z", 1, null)], null).cycleLatestPaymentId).toBe("z");
  });

  it("recalculates deletion/restoration using live rows, keeping other-cycle expenses in principal", () => {
    const payments = [pay("p1", 4000, "s1"), pay("p2", 6000, "s1")];
    expect(withProgress(base, payments.slice(0, 1), "s1").cycleStatus).toBe("partial");
    expect(withProgress(base, [], "s1").cycleLatestPaymentId).toBeNull();
    const rolledBackSalary = withProgress(base, payments, null);
    expect(rolledBackSalary).toMatchObject({ paidMinor: 10000, remainingMinor: 110000, paidThisCycleMinor: 0, cycleStatus: "unpaid" });
    expect(withProgress(base, payments, "s1").cycleStatus).toBe("paid");
  });

  it("keeps integer minor units for every currency without converting salary money", () => {
    const lbp = withProgress({ ...base, currency: "LBP", totalMinor: 1000000000000000, monthlyMinor: 999999999 }, [pay("p", 999999999, "s")], "s");
    expect(lbp.remainingMinor).toBe(999999000000001);
    expect(lbp.paidThisCycleMinor).toBe(999999999);
  });

  it("fails closed on overpaid, unsafe, duplicated, or invalid payment facts", () => {
    expect(() => withProgress(base, [pay("over", 120001, null)], null)).toThrow(RangeError);
    expect(() => withProgress(base, [pay("unsafe", Number.MAX_SAFE_INTEGER + 1, null)], null)).toThrow(RangeError);
    expect(() => withProgress(base, [pay("same", 1, null), pay("same", 1, null)], null)).toThrow(RangeError);
    expect(() => withProgress(base, [pay("zero", 0, null)], null)).toThrow(RangeError);
    expect(() => withProgress(base, [pay("date", 1, null, "2026-11-01", "invalid")], null)).toThrow(RangeError);
  });
});
