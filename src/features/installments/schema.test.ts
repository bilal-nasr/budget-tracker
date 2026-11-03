import { describe, expect, it } from "vitest";
import { dueThisMonth, withProgress } from "./schema";

const base = {
  id: "i", name: "Laptop", currency: "USD" as const, walletId: "w", categoryId: "c",
  totalMinor: 120000, paidBeforeMinor: 0, monthlyMinor: 10000, dueDay: null,
};
const pay = (amountMinor: number, occurredOn: string) => ({ transactionId: occurredOn, amountMinor, occurredOn, walletId: "w" });

describe("installment progress", () => {
  it("adds up paid, left and paid this month", () => {
    const i = withProgress(base, [pay(10000, "2026-11-02"), pay(10000, "2026-10-02"), pay(10000, "2026-09-02")], "2026-11-01");
    expect(i.paidMinor).toBe(30000);
    expect(i.remainingMinor).toBe(90000);
    expect(i.paidThisMonthMinor).toBe(10000);
  });
  it("counts what was paid before the app", () => {
    const i = withProgress({ ...base, paidBeforeMinor: 50000 }, [pay(10000, "2026-11-02")], "2026-11-01");
    expect(i.remainingMinor).toBe(60000);
  });
});

describe("dueThisMonth", () => {
  it("is the monthly amount while there is plenty left", () => {
    expect(dueThisMonth(withProgress(base, [], "2026-11-01"))).toBe(10000);
  });
  it("is zero for a paid-off installment and for no monthly amount", () => {
    expect(dueThisMonth(withProgress({ ...base, totalMinor: 10000 }, [pay(10000, "2026-09-02")], "2026-11-01"))).toBe(0);
    expect(dueThisMonth(withProgress({ ...base, monthlyMinor: null }, [], "2026-11-01"))).toBe(0);
  });
  it("is capped by what is left", () => {
    expect(dueThisMonth(withProgress({ ...base, totalMinor: 5000 }, [], "2026-11-01"))).toBe(5000);
  });
  it("keeps the monthly amount in the month the last payment was made", () => {
    const i = withProgress({ ...base, totalMinor: 20000 }, [pay(10000, "2026-10-02"), pay(10000, "2026-11-02")], "2026-11-01");
    expect(i.remainingMinor).toBe(0);
    expect(dueThisMonth(i)).toBe(10000);
  });
});
