import { describe, expect, it } from "vitest";
import { cyclePaymentInputSchema, receiveSalaryInputSchema } from "./cycle-input";
import { MAX_MINOR } from "@/lib/money";

const requestId = "a1000000-0000-4000-8000-000000000001";
const installmentId = "a2000000-0000-4000-8000-000000000001";
const walletId = "a3000000-0000-4000-8000-000000000001";
const receiptId = "a4000000-0000-4000-8000-000000000001";
const payment = { requestId, installmentId, walletId, amountMinor: 4000, occurredOn: "2026-10-31", salaryCycleId: null, overrideOfTransactionId: null };

describe("cycle write inputs", () => {
  it("requires caller-stable IDs and explicit initial-cycle/null acknowledgment", () => {
    expect(cyclePaymentInputSchema.parse(payment)).toEqual(payment);
    expect(receiveSalaryInputSchema.parse({ requestId, expectedCycleId: null })).toEqual({ requestId, expectedCycleId: null });
    for (const key of ["requestId", "salaryCycleId", "overrideOfTransactionId"] as const) {
      const input = { ...payment } as Record<string, unknown>;
      delete input[key];
      expect(cyclePaymentInputSchema.safeParse(input).success).toBe(false);
    }
    expect(receiveSalaryInputSchema.safeParse({ requestId }).success).toBe(false);
  });
  it("accepts actual receipt/extra-payment identifiers without currency conversion", () => {
    expect(cyclePaymentInputSchema.parse({ ...payment, salaryCycleId: receiptId, overrideOfTransactionId: requestId })).toMatchObject({ salaryCycleId: receiptId, overrideOfTransactionId: requestId });
    expect(receiveSalaryInputSchema.parse({ requestId, expectedCycleId: receiptId }).expectedCycleId).toBe(receiptId);
  });
  it.each([0, -1, 1.5, MAX_MINOR + 1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])("rejects invalid minor amount %s", (amountMinor) => {
    expect(cyclePaymentInputSchema.safeParse({ ...payment, amountMinor }).success).toBe(false);
  });
  it("accepts the exact integer ceiling", () => {
    expect(cyclePaymentInputSchema.parse({ ...payment, amountMinor: MAX_MINOR }).amountMinor).toBe(MAX_MINOR);
  });
  it.each(["2026-02-30", "2026-13-01", "1999-12-31", "2026-1-01", "2026-11-01T12:00:00Z"])("rejects invalid accounting date %s", (occurredOn) => {
    expect(cyclePaymentInputSchema.safeParse({ ...payment, occurredOn }).success).toBe(false);
  });
  it("does not accept browser-supplied salary amounts, source identity, or payment category", () => {
    expect(receiveSalaryInputSchema.safeParse({ requestId, expectedCycleId: null, amountMinor: 999 }).success).toBe(false);
    expect(receiveSalaryInputSchema.safeParse({ requestId, expectedCycleId: null, walletId }).success).toBe(false);
    for (const field of ["categoryId", "source", "currency", "userId"]) {
      expect(cyclePaymentInputSchema.safeParse({ ...payment, [field]: requestId }).success).toBe(false);
    }
  });
  it("rejects malformed identifiers in every cycle/write identity position", () => {
    for (const key of ["requestId", "installmentId", "walletId", "salaryCycleId", "overrideOfTransactionId"]) {
      expect(cyclePaymentInputSchema.safeParse({ ...payment, [key]: "invalid" }).success).toBe(false);
    }
    expect(receiveSalaryInputSchema.safeParse({ requestId: "invalid", expectedCycleId: null }).success).toBe(false);
    expect(receiveSalaryInputSchema.safeParse({ requestId, expectedCycleId: "invalid" }).success).toBe(false);
  });
});
