import { describe, expect, it } from "vitest";
import { allocateRepayment, calculateLoanFee, parsePercentBps, summarizeLoans } from "./calculations";
import { MAX_MINOR } from "@/lib/money";

describe("one-time loan percentage", () => {
  it("parses precise Latin and Arabic percentages without treating grouping as decimal", () => {
    for (const text of ["7.25", "٧٫٢٥", "۷.۲۵"]) expect(parsePercentBps(text)).toBe(725);
    expect(parsePercentBps("0")).toBe(0);
    expect(parsePercentBps("100.00")).toBe(10000);
    for (const text of ["", "7.251", "1,5", "-1", "1e2", "NaN", "101", "7%", "1 0"]) {
      expect(parsePercentBps(text)).toBeNull();
    }
  });
  it("rounds once, half up, with exact large intermediates", () => {
    expect(calculateLoanFee(100000, 725)).toEqual({ feeMinor: 7250, totalDueMinor: 107250 });
    expect(calculateLoanFee(5, 1000)).toEqual({ feeMinor: 1, totalDueMinor: 6 });
    expect(calculateLoanFee(1, 1)).toEqual({ feeMinor: 0, totalDueMinor: 1 });
    expect(calculateLoanFee(499999999999999, 1)).toEqual({ feeMinor: 50000000000, totalDueMinor: 500049999999999 });
    expect(calculateLoanFee(1250, 725)).toEqual({ feeMinor: 91, totalDueMinor: 1341 });
    expect(calculateLoanFee(MAX_MINOR, 0)?.totalDueMinor).toBe(MAX_MINOR);
    expect(calculateLoanFee(MAX_MINOR, 1)).toBeNull();
    for (const value of [0, -1, 0.5, NaN, Infinity, MAX_MINOR + 1]) expect(calculateLoanFee(value, 100)).toBeNull();
    for (const rate of [-1, 0.1, 10001, NaN]) expect(calculateLoanFee(100, rate)).toBeNull();
  });
});

describe("principal-first repayment", () => {
  it("pays principal first and caps the final payment at all remaining components", () => {
    expect(allocateRepayment(40000, 100000, 7250)).toEqual({ principalMinor: 40000, feeMinor: 0 });
    expect(allocateRepayment(65000, 60000, 7250)).toEqual({ principalMinor: 60000, feeMinor: 5000 });
    expect(allocateRepayment(2250, 0, 2250)).toEqual({ principalMinor: 0, feeMinor: 2250 });
    expect(allocateRepayment(2251, 0, 2250)).toBeNull();
    expect(allocateRepayment(0, 100, 0)).toBeNull();
    expect(allocateRepayment(1, -1, 100)).toBeNull();
  });
  it("keeps directions and currencies separate, excludes canceled loans, and rejects overflow", () => {
    const loan = { direction: "borrowed" as const, currency: "USD" as const, remainingMinor: 600, deletedAt: null };
    const totals = summarizeLoans([loan, { ...loan, direction: "lent", remainingMinor: 900 }, { ...loan, currency: "LBP", remainingMinor: 50 }, { ...loan, deletedAt: "2026-11-04", remainingMinor: 999 }]);
    expect(totals?.USD).toEqual({ owedMinor: 600, receivableMinor: 900 });
    expect(totals?.LBP).toEqual({ owedMinor: 50, receivableMinor: 0 });
    expect(summarizeLoans([{ ...loan, remainingMinor: MAX_MINOR }, { ...loan, remainingMinor: 1 }])).toBeNull();
  });
});
