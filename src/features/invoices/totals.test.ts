import { describe, expect, it } from "vitest";
import { MAX_MINOR } from "@/lib/money";
import { lineMinor, totalsByCurrency } from "./totals";

const row = (currency: string, decimalPlaces: number, priceMinor: number, quantity = 1) => ({ currency, decimalPlaces, priceMinor, quantity });

describe("lineMinor", () => {
  it("is the unit price times the quantity", () => {
    expect(lineMinor({ priceMinor: 5000, quantity: 1 })).toBe(5000);
    expect(lineMinor({ priceMinor: 1_350_000, quantity: 3 })).toBe(4_050_000);
  });
  it("stays exact at the top of the range", () => {
    expect(lineMinor({ priceMinor: MAX_MINOR / 10, quantity: 10 })).toBe(MAX_MINOR);
  });
});

describe("totalsByCurrency", () => {
  it("adds each row's total (price x quantity), not its unit price", () => {
    expect(totalsByCurrency([row("USD", 2, 5000, 2), row("USD", 2, 300, 3), row("LBP", 0, 450_000, 2)])).toEqual([
      { currency: "USD", decimalPlaces: 2, minor: 10_900 },
      { currency: "LBP", decimalPlaces: 0, minor: 900_000 },
    ]);
  });

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
