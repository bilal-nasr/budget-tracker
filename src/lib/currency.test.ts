import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  CURRENCY_DECIMALS,
  MAX_MINOR,
  MAX_RATE,
  currencyPrefix,
  emptyCurrencyTotals,
  isCurrency,
  supportsUsdLbpRate,
  type Currency,
} from "./currency";

describe("currency registry", () => {
  it("keeps stable currency order and explicit ledger precision", () => {
    expect(CURRENCIES).toEqual(["USD", "LBP", "SYP"]);
    expect(CURRENCY_DECIMALS).toEqual({ USD: 2, LBP: 0, SYP: 2 });
    expect(Object.isFrozen(CURRENCIES)).toBe(true);
    expect(Object.isFrozen(CURRENCY_DECIMALS)).toBe(true);
    expect(MAX_MINOR).toBe(1_000_000_000_000_000);
    expect(Number.isSafeInteger(MAX_MINOR)).toBe(true);
    expect(MAX_RATE).toBe(10_000_000);
  });

  it.each(CURRENCIES)("recognizes the exact %s currency code", (currency) => {
    expect(isCurrency(currency)).toBe(true);
  });

  it.each([undefined, null, "", "EUR", "syp", " SYP", "SYP ", ["SYP"], 760, {}])(
    "rejects an unsupported or malformed code: %j",
    (value) => expect(isCurrency(value)).toBe(false),
  );

  it("gives SYP its own prefix instead of a non-USD LBP fallback", () => {
    expect(currencyPrefix("USD")).toBe("$");
    expect(currencyPrefix("LBP")).toBe("LBP");
    expect(currencyPrefix("SYP")).toBe("SYP");
    expect(() => currencyPrefix("EUR" as Currency)).toThrow(RangeError);
  });

  it("creates fresh complete totals without sharing mutable state", () => {
    const first = emptyCurrencyTotals();
    const second = emptyCurrencyTotals();
    first.SYP = 1250;
    expect(first).toEqual({ USD: 0, LBP: 0, SYP: 1250 });
    expect(second).toEqual({ USD: 0, LBP: 0, SYP: 0 });
    expect(first).not.toBe(second);
  });
});

describe("USD/LBP reference-rate boundary", () => {
  it.each(CURRENCIES.flatMap((from) => CURRENCIES.map((to) => [from, to] as const)))(
    "supports only the explicitly different-currency USD/LBP pair: %s → %s",
    (from, to) => {
      expect(supportsUsdLbpRate(from, to)).toBe(
        (from === "USD" && to === "LBP") || (from === "LBP" && to === "USD"),
      );
    },
  );
});
