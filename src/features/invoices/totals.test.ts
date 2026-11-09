import { describe, expect, it } from "vitest";
import { MAX_MINOR } from "@/lib/money";
import { totalsByCurrency } from "./totals";

const row = (currency: string, decimalPlaces: number, priceMinor: number) => ({ currency, decimalPlaces, priceMinor });

describe("totalsByCurrency", () => {
  it("sums per currency in order of first appearance", () => {
    expect(totalsByCurrency([row("USD", 2, 250), row("USD", 2, 450), row("USD", 2, 100), row("LBP", 0, 1_500_000)])).toEqual([
      { currency: "USD", decimalPlaces: 2, minor: 800 },
      { currency: "LBP", decimalPlaces: 0, minor: 1_500_000 },
    ]);
  });

  it("keeps the same code with different decimals apart", () => {
    expect(totalsByCurrency([row("USD", 2, 100), row("USD", 3, 100), row("USD", 2, 5)])).toEqual([
      { currency: "USD", decimalPlaces: 2, minor: 105 },
      { currency: "USD", decimalPlaces: 3, minor: 100 },
    ]);
  });

  it("marks only the overflowing currency as null", () => {
    expect(totalsByCurrency([row("USD", 2, MAX_MINOR), row("USD", 2, MAX_MINOR), row("LBP", 0, 10)])).toEqual([
      { currency: "USD", decimalPlaces: 2, minor: null },
      { currency: "LBP", decimalPlaces: 0, minor: 10 },
    ]);
  });

  it("returns nothing for no rows", () => {
    expect(totalsByCurrency([])).toEqual([]);
  });
});
