import { describe, expect, it } from "vitest";
import { currencyInputSchema } from "./schema";

describe("currency input", () => {
  it("normalizes and validates custom definitions", () => {
    expect(currencyInputSchema.parse({ code: " btc ", symbol: " ₿ ", decimalPlaces: 8 }))
      .toEqual({ code: "BTC", symbol: "₿", decimalPlaces: 8 });
    for (const code of ["", "1BTC", "BT-C", "ABCDEFGHIJKLM", "éur"]) {
      expect(currencyInputSchema.safeParse({ code, symbol: "₿", decimalPlaces: 8 }).success).toBe(false);
    }
    for (const decimalPlaces of [-1, 9, 1.5]) {
      expect(currencyInputSchema.safeParse({ code: "BTC", symbol: "₿", decimalPlaces }).success).toBe(false);
    }
    for (const symbol of ["", "  ", "🪙".repeat(13)]) {
      expect(currencyInputSchema.safeParse({ code: "BTC", symbol, decimalPlaces: 8 }).success).toBe(false);
    }
    expect(currencyInputSchema.safeParse({ code: "TOKEN1", symbol: "🪙".repeat(12), decimalPlaces: 0 }).success)
      .toBe(true);
  });
});
