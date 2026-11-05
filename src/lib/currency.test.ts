import { describe, expect, it } from "vitest";
import {
  supportsUsdLbpRate,
  SEED_CURRENCY_DEFINITIONS,
  enabledCurrencies,
  indexCurrencies,
  requireCurrency,
} from "./currency";

describe("runtime currency catalog", () => {
  const btc = { code: "BTC", symbol: "₿", decimalPlaces: 8, disabled: false, firstUsed: false };
  const disabled = { code: "OLD", symbol: "OLD", decimalPlaces: 3, disabled: true, firstUsed: true };

  it("resolves runtime and historical definitions without falling back", () => {
    const definitions = indexCurrencies([btc, disabled]);
    expect(definitions.get("BTC")).toEqual(btc);
    expect(requireCurrency("BTC", [btc, disabled])).toEqual(btc);
    expect(requireCurrency("OLD", [btc, disabled])).toEqual(disabled);
    expect(() => requireCurrency("USD", [btc, disabled])).toThrow();
    expect(() => indexCurrencies([btc, btc])).toThrow();
  });

  it("offers only enabled definitions while retaining seeded precision", () => {
    expect(enabledCurrencies([disabled, btc])).toEqual([btc]);
    expect(SEED_CURRENCY_DEFINITIONS).toEqual([
      { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: false },
      { code: "LBP", symbol: "LBP", decimalPlaces: 0, disabled: false, firstUsed: false },
      { code: "SYP", symbol: "SYP", decimalPlaces: 0, disabled: false, firstUsed: false },
    ]);
  });
});

describe("USD/LBP reference-rate boundary", () => {
  it.each(["USD", "LBP", "SYP", "BTC"].flatMap((from) => ["USD", "LBP", "SYP", "BTC"].map((to) => [from, to] as const)))(
    "supports only the explicitly different-currency USD/LBP pair: %s → %s",
    (from, to) => {
      expect(supportsUsdLbpRate(from, to)).toBe(
        (from === "USD" && to === "LBP") || (from === "LBP" && to === "USD"),
      );
    },
  );
});
