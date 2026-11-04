import { describe, expect, it } from "vitest";
import { dueThisCycle, withProgress, installmentInputSchema, installmentPaymentSchema } from "./schema";

const base = {
  id: "i", name: "Laptop", currency: "USD" as const, walletId: "w", categoryId: "c",
  totalMinor: 120000, paidBeforeMinor: 0, monthlyMinor: 10000, dueDay: null,
};
const pay = (amountMinor: number, occurredOn: string, salaryCycleId = "salary") => ({ transactionId: occurredOn, amountMinor, occurredOn, walletId: "w", salaryCycleId, createdAt: `${occurredOn}T12:00:00Z`, revision: 1 });

describe("installment progress", () => {
  it("public schema uses receipt progress even when a payment's accounting month differs", () => {
    const i = withProgress(base, [pay(10000, "2026-11-02"), pay(10000, "2026-10-02", "older"), pay(10000, "2026-09-02", "older")], "salary");
    expect(i.paidMinor).toBe(30000);
    expect(i.remainingMinor).toBe(90000);
    expect(i.paidThisCycleMinor).toBe(10000);
  });
  it("counts what was paid before the app", () => {
    const i = withProgress({ ...base, paidBeforeMinor: 50000 }, [pay(10000, "2026-11-02")], "salary");
    expect(i.remainingMinor).toBe(60000);
  });
});

describe("dueThisCycle", () => {
  it("is the monthly amount while there is plenty left", () => {
    expect(dueThisCycle(withProgress(base, [], "salary"))).toBe(10000);
  });
  it("is zero for a paid-off installment and for no monthly amount", () => {
    expect(dueThisCycle(withProgress({ ...base, totalMinor: 10000 }, [pay(10000, "2026-09-02", "older")], "salary"))).toBe(0);
    expect(dueThisCycle(withProgress({ ...base, monthlyMinor: null }, [], "salary"))).toBe(0);
  });
  it("is capped by what is left", () => {
    expect(dueThisCycle(withProgress({ ...base, totalMinor: 5000 }, [], "salary"))).toBe(5000);
  });
  it("keeps the final target within its actual receipt cycle", () => {
    const i = withProgress({ ...base, totalMinor: 20000 }, [pay(10000, "2026-10-02", "older"), pay(10000, "2026-11-02")], "salary");
    expect(i.remainingMinor).toBe(0);
    expect(dueThisCycle(i)).toBe(10000);
  });
  it("requires an explicit stable payment request and keeps template principal validation", () => {
    expect(installmentPaymentSchema.safeParse({ installmentId: "00000000-0000-4000-8000-000000000001" }).success).toBe(false);
    expect(installmentInputSchema.safeParse({ ...base, totalMinor: 100, paidBeforeMinor: 101,
      walletId: "00000000-0000-4000-8000-000000000001", categoryId: "00000000-0000-4000-8000-000000000002" }).success).toBe(false);
  });
});
