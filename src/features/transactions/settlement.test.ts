import { describe, expect, it } from "vitest";
import { MAX_MINOR, type Currency } from "@/lib/money";
import { cashSettlementInputSchema, convertSettlementMinor, parseSettlementRate, settlementRateText, validateSettlement } from "./settlement";

const walletId = "aaaaaaaa-0000-4000-8000-000000000001";
const rate = { base: "USD" as const, quote: "LBP" as const, quoteMajorNumerator: 89500, quoteMajorDenominator: 1 };
describe("cash settlement", () => {
  it("records USD and LBP change from one USD tender without calculating a rate", () => {
    const settlement = { tenderMinor: 2000, changes: [
      { walletId, amountMinor: 500 },
      { walletId: "aaaaaaaa-0000-4000-8000-000000000002", amountMinor: 223750 },
    ] };
    expect(validateSettlement({ costMinor: 1250, payCurrency: "USD", changeCurrencies: ["USD", "LBP"], settlement })).toEqual({ ok: true });
    expect(cashSettlementInputSchema.parse(settlement)).toEqual(settlement);
  });
  it("requires exact same-currency reconciliation, including exact tender without change", () => {
    expect(validateSettlement({ costMinor: 1250, payCurrency: "USD", changeCurrencies: [], settlement: { tenderMinor: 1250, changes: [] } })).toEqual({ ok: true });
    expect(validateSettlement({ costMinor: 1250, payCurrency: "USD", changeCurrencies: [], settlement: { tenderMinor: 2000, changes: [] } })).toEqual({ ok: false, reason: "mismatch" });
    expect(validateSettlement({ costMinor: 1250, payCurrency: "USD", changeCurrencies: ["USD", "USD"], settlement: { tenderMinor: 2000, changes: [
      { walletId, amountMinor: 500 }, { walletId, amountMinor: 250 },
    ] } })).toEqual({ ok: true });
  });
  it.each([ ["USD", "LBP"], ["LBP", "USD"], ["USD", "SYP"], ["SYP", "LBP"] ] as const)("records actual %s paid and %s change without a rate", (payCurrency, changeCurrency) => {
    expect(validateSettlement({ costMinor: 400, payCurrency, changeCurrencies: [changeCurrency],
      settlement: { tenderMinor: 500, changes: [{ walletId, amountMinor: 10000 }] } })).toEqual({ ok: true });
    expect(validateSettlement({ costMinor: 500, payCurrency, changeCurrencies: [changeCurrency],
      settlement: { tenderMinor: 500, changes: [{ walletId, amountMinor: 10000 }] } })).toEqual({ ok: false, reason: "mismatch" });
  });
  it("rejects mixed change when same-currency returns leave no value for the foreign leg", () => {
    for (const usdChange of [750, 800]) {
      expect(validateSettlement({ costMinor: 1250, payCurrency: "USD", changeCurrencies: ["USD", "LBP"],
        settlement: { tenderMinor: 2000, changes: [
          { walletId, amountMinor: usdChange }, { walletId, amountMinor: 1 },
        ] } })).toEqual({ ok: false, reason: "mismatch" });
    }
  });
  it("rejects malformed legs and exact aggregate overflow", () => {
    expect(cashSettlementInputSchema.safeParse({ tenderMinor: 2000, changes: [{ walletId, amountMinor: 0 }] }).success).toBe(false);
    expect(cashSettlementInputSchema.safeParse({ tenderMinor: 2000, changes: [{ walletId, amountMinor: 1, currency: "USD" }] }).success).toBe(false);
    expect(validateSettlement({ costMinor: 1, payCurrency: "USD", changeCurrencies: Array(10).fill("USD"),
      settlement: { tenderMinor: MAX_MINOR, changes: Array.from({ length: 10 }, () => ({ walletId, amountMinor: MAX_MINOR })) } })).toEqual({ ok: false, reason: "mismatch" });
  });
  it("uses half-up rounding once and preserves actual cash", () => {
    const r = { ...rate, quoteMajorNumerator: 200 };
    expect(convertSettlementMinor(1, "LBP", "USD", r)).toBe(1);
    expect(validateSettlement({ costMinor: 999, payCurrency: "USD", changeCurrencies: ["LBP"], settlement: { tenderMinor: 1000, changes: [{ walletId, amountMinor: 1, rate: r }] } })).toEqual({ ok: true });
    expect(convertSettlementMinor(MAX_MINOR, "USD", "LBP", rate)).toBeNull();
  });
  it("keeps the exact sub-half boundary at a large direct SYP quote", () => {
    const quote = { base: "USD" as const, quote: "SYP" as const,
      quoteMajorNumerator: 999999999999999, quoteMajorDenominator: 1000000 };
    // Decimal division can round the first value to an integer before floor.
    expect(convertSettlementMinor(9999994999999, "SYP", "USD", quote)).toBe(999999);
    expect(convertSettlementMinor(9999995000000, "SYP", "USD", quote)).toBe(1000000);
  });
  it("rejects malformed inputs without throwing or floating point coercion", () => {
    for (const amount of [NaN, Infinity, -1, 0.1, MAX_MINOR + 1]) expect(convertSettlementMinor(amount, "USD", "LBP", rate)).toBeNull();
    expect(convertSettlementMinor(1, "USD", "LBP", { ...rate, quoteMajorDenominator: 0 })).toBeNull();
    for (const invalid of [0.1, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) {
      expect(convertSettlementMinor(1, "USD", "LBP", { ...rate, quoteMajorNumerator: invalid })).toBeNull();
      expect(convertSettlementMinor(1, "USD", "LBP", { ...rate, quoteMajorDenominator: invalid })).toBeNull();
    }
    expect(cashSettlementInputSchema.safeParse({ tenderMinor: 2000, hidden: true, changes: [] }).success).toBe(false);
    expect(validateSettlement({ costMinor: 1250, payCurrency: "USD", changeCurrencies: ["USD"], settlement: { tenderMinor: 2000, changes: [{ walletId, amountMinor: 750, rate }] } }).ok).toBe(false);
  });
  it("parses canonical quotes exactly with bilingual digits", () => {
    expect(parseSettlementRate("٨٩٬٥٠٠", "LBP", "USD")).toEqual(rate);
    expect(parseSettlementRate("۸۹٬۵۰۰", "LBP", "USD")).toEqual(rate);
    for (const value of ["0", "-1", "1e4", "1.5", "10000001", "89x"]) expect(parseSettlementRate(value, "USD", "LBP")).toBeNull();
    expect(settlementRateText(rate)).toBe("89500");
    expect(parseSettlementRate("1", "USD", "USD")).toBeNull();
  });
  it("supports SYP only through its registered whole-pound unit and a direct quote", () => {
    const syp = "SYP" as Currency;
    const r = parseSettlementRate("13000", "USD", syp)!;
    expect(convertSettlementMinor(97500, syp, "USD", r)).toBe(750);
    expect(convertSettlementMinor(750, "USD", syp, r)).toBe(97500);
    const fractional = parseSettlementRate("٠٫٠١", "LBP", syp)!;
    expect(fractional.quoteMajorNumerator).toBe(1);
    expect(fractional.quoteMajorDenominator).toBe(100);
    expect(settlementRateText(fractional)).toBe("0.01");
    expect(convertSettlementMinor(500, syp, "LBP", fractional)).toBe(50000);
    expect(parseSettlementRate("0.0000001", "LBP", syp)).toBeNull();
    expect(parseSettlementRate("1000000000.000001", "LBP", syp)).toBeNull();
  });
});
