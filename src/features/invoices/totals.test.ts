import { describe, expect, it } from "vitest";
import { MAX_MINOR } from "@/lib/money";
import { groupByCurrency, isPaid, lineMinor, totalsByCurrency, unpaidTotals } from "./totals";

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

describe("paid rows", () => {
  const paid = (currency: string, decimalPlaces: number, priceMinor: number, quantity: number, paidOn: string | null) => ({ ...row(currency, decimalPlaces, priceMinor, quantity), paidOn });

  it("a row is paid exactly while it has a paid date", () => {
    expect(isPaid({ paidOn: "2026-11-06" })).toBe(true);
    expect(isPaid({ paidOn: null })).toBe(false);
  });

  it("still to pay leaves paid rows out, per currency and never mixed", () => {
    expect(unpaidTotals([paid("USD", 2, 25_000, 1, "2026-11-06"), paid("USD", 2, 1500, 3, null), paid("LBP", 0, 900_000, 1, null)])).toEqual([
      { currency: "USD", decimalPlaces: 2, minor: 4500 },
      { currency: "LBP", decimalPlaces: 0, minor: 900_000 },
    ]);
    // A currency whose rows are all paid has no line at all.
    expect(unpaidTotals([paid("USD", 2, 100, 1, "2026-11-06"), paid("LBP", 0, 5, 1, null)])).toEqual([{ currency: "LBP", decimalPlaces: 0, minor: 5 }]);
    expect(unpaidTotals([paid("USD", 2, 100, 1, "2026-11-06")])).toEqual([]);
  });
});

describe("groupByCurrency", () => {
  it("makes one group per currency and decimals, in order of first appearance", () => {
    const [a, b, c, d] = [row("USD", 2, 1), row("LBP", 0, 2), row("USD", 2, 3), row("USD", 3, 4)];
    expect(groupByCurrency([a, b, c, d])).toEqual([
      { currency: "USD", decimalPlaces: 2, rows: [a, c] },
      { currency: "LBP", decimalPlaces: 0, rows: [b] },
      { currency: "USD", decimalPlaces: 3, rows: [d] },
    ]);
    expect(groupByCurrency([])).toEqual([]);
  });
});
