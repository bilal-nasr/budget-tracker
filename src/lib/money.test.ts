import { requireCurrency, SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount } from "./money";

describe("runtime money definitions", () => {
  const btc = { code: "BTC", symbol: "₿", decimalPlaces: 8, disabled: false, firstUsed: false };
  const lbp = { code: "LBP", symbol: "LBP", decimalPlaces: 0, disabled: false, firstUsed: false };

  it("formats runtime precision without floating point", () => {
    expect(parseAmount("0.00000001", btc)).toBe(1);
    expect(formatAmount(1, btc)).toBe("₿0.00000001");
    expect(parseAmount("10000000.00000001", btc)).toBeNull();
    expect(parseAmount("10000000.00000000", btc)).toBe(MAX_MINOR);
    expect(formatAmount(MAX_MINOR - 1, btc)).toBe("₿9,999,999.99999999");
    expect(toInputText(MAX_MINOR - 1, btc)).toBe("9999999.99999999");
    expect(toInputText(120000000, btc)).toBe("1.2");
    expect(parseAmount("٠٫٠٠٠٠٠٠٠١", btc)).toBe(1);
    expect(formatAmount(-1, btc, { digits: "arabic" })).toBe("−₿٠٫٠٠٠٠٠٠٠١");
    expect(parseAmount("0.000000001", btc)).toBeNull();
    expect(parseAmount("1.0", lbp)).toBeNull();
    expect(formatAmount(1250, { ...btc, disabled: true })).toBe("₿0.00001250");
  });

  it("separates letter and symbol prefixes", () => {
    expect(formatAmount(1250, lbp)).toBe("LBP 1,250");
    expect(formatAmount(1250, { ...lbp, symbol: "ل.ل" })).toBe("ل.ل 1,250");
    expect(formatAmount(1250, { ...lbp, symbol: "¤1" })).toBe("¤1 1,250");
    expect(formatAmount(1250, { ...lbp, symbol: "€" })).toBe("€1,250");
    expect(formatAmount(1250, { ...lbp, symbol: "🪙" })).toBe("🪙1,250");
  });
});

describe("parseAmount", () => {
  it("parses USD to cents", () => {
    expect(parseAmount("12.5", requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe(1250);
    expect(parseAmount("12", requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe(1200);
    expect(parseAmount("0.05", requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe(5);
  });
  it("parses LBP as whole lira and rejects decimals", () => {
    expect(parseAmount("1,500,000", requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS))).toBe(1500000);
    expect(parseAmount("10.5", requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS))).toBeNull();
  });
  it("accepts Arabic-Indic digits and separators", () => {
    expect(parseAmount("١٢٫٥٠", requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe(1250);
    expect(parseAmount("١٬٥٠٠", requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS))).toBe(1500);
  });
  it("rejects garbage", () => {
    expect(parseAmount("", requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBeNull();
    expect(parseAmount("-5", requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBeNull();
    expect(parseAmount("1.234", requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBeNull();
    expect(parseAmount("abc", requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS))).toBeNull();
  });
});

describe("formatAmount", () => {
  it("formats both currencies", () => {
    expect(formatAmount(123456, requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe("$1,234.56");
    expect(formatAmount(1500000, requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS))).toBe("LBP 1,500,000");
  });
  it("shows sign as text", () => {
    expect(formatAmount(-500, requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe("−$5.00");
    expect(formatAmount(500, requireCurrency("USD", SEED_CURRENCY_DEFINITIONS), { sign: true })).toBe("+$5.00");
  });
});

import { MAX_MINOR, MoneyRangeError, groupTyped, parseRate, readMinor, sumMinor, toInputText } from "./money";

describe("SYP whole-pound amounts", () => {
  it.each([
    ["12", 12], ["1,250", 1250], ["١٬٢٣٤", 1234], ["۱۲۵۰", 1250],
  ] as const)("parses %s as whole pounds", (typed, expected) => {
    expect(parseAmount(typed, requireCurrency("SYP", SEED_CURRENCY_DEFINITIONS))).toBe(expected);
  });
  it.each(["", "-1", "12.5", "0.01", "١٢٫٥٠", "NaN", "1000000000000001"])("rejects invalid SYP %s", (typed) => {
    expect(parseAmount(typed, requireCurrency("SYP", SEED_CURRENCY_DEFINITIONS))).toBeNull();
  });
  it("round-trips whole pounds without scaling or decimal formatting", () => {
    for (const minor of [0, 1, 1250, MAX_MINOR - 1, MAX_MINOR]) {
      expect(parseAmount(toInputText(minor, requireCurrency("SYP", SEED_CURRENCY_DEFINITIONS)), requireCurrency("SYP", SEED_CURRENCY_DEFINITIONS))).toBe(minor);
    }
    expect(formatAmount(MAX_MINOR - 1, requireCurrency("SYP", SEED_CURRENCY_DEFINITIONS))).toBe("SYP 999,999,999,999,999");
    expect(formatAmount(1250, requireCurrency("SYP", SEED_CURRENCY_DEFINITIONS))).toBe("SYP 1,250");
    expect(formatAmount(-1250, requireCurrency("SYP", SEED_CURRENCY_DEFINITIONS))).toBe("−SYP 1,250");
    expect(formatAmount(1250, requireCurrency("SYP", SEED_CURRENCY_DEFINITIONS), { sign: true })).toBe("+SYP 1,250");
    expect(formatAmount(1250, requireCurrency("SYP", SEED_CURRENCY_DEFINITIONS), { digits: "arabic" })).toBe("SYP ١٬٢٥٠");
  });

});

describe("stored minor-unit bounds", () => {
  it("reads signed database integers and sums exactly, allowing cancellation", () => {
    expect(readMinor("-1250")).toBe(-1250);
    expect(readMinor(String(MAX_MINOR))).toBe(MAX_MINOR);
    expect(sumMinor([MAX_MINOR, MAX_MINOR, -MAX_MINOR])).toBe(MAX_MINOR);
    expect(sumMinor([-1250, 250])).toBe(-1000);
  });
  it.each(["1.5", "", "1e3", "NaN", "1000000000000001", Number.NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an unrepresentable stored amount %j", (value) => {
      expect(() => readMinor(value)).toThrow(MoneyRangeError);
    },
  );
  it("refuses out-of-domain totals and invalid formatting inputs", () => {
    expect(() => sumMinor([MAX_MINOR, 1])).toThrow(MoneyRangeError);
    expect(() => formatAmount(1.5, requireCurrency("SYP", SEED_CURRENCY_DEFINITIONS))).toThrow(MoneyRangeError);
  });

});

describe("typed amounts", () => {
  it("round-trips minor units to input text", () => {
    expect(toInputText(5420, requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe("54.2");
    expect(toInputText(5000, requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe("50");
    expect(toInputText(5, requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe("0.05");
    expect(toInputText(400000, requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS))).toBe("400000");
  });
  it("groups digits while typing", () => {
    expect(groupTyped("1234567.5")).toBe("1,234,567.5");
    expect(groupTyped("")).toBe("0");
    expect(groupTyped("54.")).toBe("54.");
  });
});

describe("exchange rate", () => {
  it("parses whole-number rates", () => {
    expect(parseRate("89500")).toBe(89500);
    expect(parseRate("89,500")).toBe(89500);
    expect(parseRate("٨٩٥٠٠")).toBe(89500);
    expect(parseRate("0")).toBeNull();
    expect(parseRate("89500.5")).toBeNull();
    expect(parseRate("10000001")).toBeNull();
    expect(parseRate("")).toBeNull();
  });
});
