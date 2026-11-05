import { describe, expect, it } from "vitest";
import { MAX_MINOR } from "@/lib/money";
import { calculateLoanPaymentPlan, parseLoanPaymentCount, suggestLoanPayment } from "./calculations";
import { loanCreateSchema, loanEditSchema } from "./schema";

const input = {
  requestId: "20000000-0000-4000-8000-000000000001", name: "Monthly example", direction: "borrowed",
  principalMinor: 200000, feeBps: 0, balanceId: "20000000-0000-4000-8000-000000000002",
  feeCategoryId: "20000000-0000-4000-8000-000000000003", openedOn: "2026-01-01", creationMode: "existing",
  principalPaidBeforeMinor: 0, feePaidBeforeMinor: 0,
};

describe("loan repayment preferences", () => {
  it("accepts Arabic payment counts without accepting decimals or grouping", () => {
    expect(parseLoanPaymentCount("٧")).toBe(7);
    expect(parseLoanPaymentCount("۱۲۰۰")).toBe(1200);
    for (const text of ["", "1.5", "7.0", "1,200", "0", "1201"]) expect(parseLoanPaymentCount(text)).toBeNull();
  });
  it("calculates the last payment exactly from the total, monthly amount and inclusive count", () => {
    expect(calculateLoanPaymentPlan(200000, 28500, 7)).toEqual({ finalPaymentMinor: 29000 });
    expect(calculateLoanPaymentPlan(200001, 28500, 7)).toEqual({ finalPaymentMinor: 29001 });
    expect(calculateLoanPaymentPlan(200000, 28500, 1)).toEqual({ finalPaymentMinor: 200000 });
    for (const count of [0, 1.5, 1201, NaN]) expect(calculateLoanPaymentPlan(200000, 28500, count)).toBeNull();
    expect(calculateLoanPaymentPlan(200000, 28500, 9)).toBeNull();
    expect(calculateLoanPaymentPlan(MAX_MINOR, MAX_MINOR, 1200)).toBeNull();
  });
  it("suggests six monthly payments of 285 and a final payment of 290 for a 2000 balance", () => {
    let remaining = 200000;
    const payments = [];
    while (remaining > 0) {
      const suggested = suggestLoanPayment(remaining, 28500, 29000)!;
      payments.push(suggested.amountMinor);
      expect(suggested.isFinal).toBe(remaining === 29000);
      remaining -= suggested.amountMinor;
    }
    expect(payments).toEqual([28500, 28500, 28500, 28500, 28500, 28500, 29000]);
  });
  it("keeps the old full-balance default without a plan and caps monthly-only remainders", () => {
    expect(suggestLoanPayment(67250, null, null)).toEqual({ amountMinor: 67250, isFinal: true });
    expect(suggestLoanPayment(10000, 28500, null)).toEqual({ amountMinor: 10000, isFinal: true });
    expect(suggestLoanPayment(50000, 28500, null)).toEqual({ amountMinor: 28500, isFinal: false });
  });
  it("caps the final suggestion after partial/extra payments instead of creating extra debt", () => {
    expect(suggestLoanPayment(14500, 28500, 29000)).toEqual({ amountMinor: 14500, isFinal: true });
    expect(suggestLoanPayment(29000, 28500, 29000)).toEqual({ amountMinor: 29000, isFinal: true });
    expect(suggestLoanPayment(0, 28500, 29000)).toEqual({ amountMinor: 0, isFinal: true });
    expect(suggestLoanPayment(MAX_MINOR, MAX_MINOR, MAX_MINOR)).toEqual({ amountMinor: MAX_MINOR, isFinal: true });
  });
  it("fails closed on invalid preferences or unsafe amounts", () => {
    for (const [remaining, monthly, final] of [[NaN, 100, 100], [MAX_MINOR + 1, 100, 100], [100, 0, 10], [100, 10, -1], [100, null, 10], [100, 10.5, null]]) {
      expect(suggestLoanPayment(remaining as number, monthly, final)).toBeNull();
    }
  });
  it("validates the optional monthly amount and inclusive payment count", () => {
    const plan = { monthlyPaymentMinor: 28500, paymentCount: 7 };
    expect(loanCreateSchema.parse({ ...input, ...plan })).toMatchObject(plan);
    expect(loanCreateSchema.safeParse(input).success).toBe(true);
    expect(loanCreateSchema.safeParse({ ...input, monthlyPaymentMinor: null, paymentCount: null }).success).toBe(true);
    for (const plan of [{ monthlyPaymentMinor: null }, { paymentCount: null }, { monthlyPaymentMinor: 0, paymentCount: 7 }, { monthlyPaymentMinor: 1.5, paymentCount: 7 }, { paymentCount: 7 }, { monthlyPaymentMinor: 28500, paymentCount: 9 }]) {
      expect(loanCreateSchema.safeParse({ ...input, ...plan }).success).toBe(false);
    }
  });
  it("distinguishes omitted edits from explicitly clearing both fields", () => {
    const edit = { name: input.name, balanceId: input.balanceId, feeCategoryId: input.feeCategoryId };
    expect(loanEditSchema.parse(edit)).not.toHaveProperty("monthlyPaymentMinor");
    expect(loanEditSchema.parse({ ...edit, monthlyPaymentMinor: null, paymentCount: null })).toMatchObject({ monthlyPaymentMinor: null, paymentCount: null });
    expect(loanEditSchema.safeParse({ ...edit, monthlyPaymentMinor: null, paymentCount: 7 }).success).toBe(false);
  });
});
