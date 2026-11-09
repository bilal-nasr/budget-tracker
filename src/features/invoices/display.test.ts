import { describe, expect, it } from "vitest";
import { indexCurrencies, SEED_CURRENCY_DEFINITIONS, type CurrencyDefinition } from "@/lib/currency";
import { canAddIn, rowDefinition } from "./display";

const catalog = indexCurrencies(SEED_CURRENCY_DEFINITIONS);
const def = (code: string, disabled = false): CurrencyDefinition => ({ code, symbol: code, decimalPlaces: 2, disabled, firstUsed: false });

describe("rowDefinition", () => {
  it("falls back to the code for a currency the viewer does not have", () => {
    expect(rowDefinition({ currency: "XYZ", decimalPlaces: 3 }, catalog)).toEqual({
      code: "XYZ", symbol: "XYZ", decimalPlaces: 3, disabled: false, firstUsed: false,
    });
  });

  it("keeps the viewer's symbol but takes decimals from the row", () => {
    const usd = rowDefinition({ currency: "USD", decimalPlaces: 3 }, catalog);
    expect(usd.symbol).toBe("$");
    expect(usd.decimalPlaces).toBe(3);
    expect(usd.code).toBe("USD");
  });
});

describe("canAddIn", () => {
  it("allows only currencies the viewer has enabled", () => {
    const enabled = [def("USD"), def("LBP")];
    expect(canAddIn("USD", enabled)).toBe(true);
    expect(canAddIn("SYP", enabled)).toBe(false);
  });

  it("rejects a disabled definition", () => {
    expect(canAddIn("USD", [def("USD", true)])).toBe(false);
  });
});
