import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount } from "./money";

describe("parseAmount", () => {
  it("parses USD to cents", () => {
    expect(parseAmount("12.5", "USD")).toBe(1250);
    expect(parseAmount("12", "USD")).toBe(1200);
    expect(parseAmount("0.05", "USD")).toBe(5);
  });
  it("parses LBP as whole lira and rejects decimals", () => {
    expect(parseAmount("1,500,000", "LBP")).toBe(1500000);
    expect(parseAmount("10.5", "LBP")).toBeNull();
  });
  it("accepts Arabic-Indic digits and separators", () => {
    expect(parseAmount("١٢٫٥٠", "USD")).toBe(1250);
    expect(parseAmount("١٬٥٠٠", "LBP")).toBe(1500);
  });
  it("rejects garbage", () => {
    expect(parseAmount("", "USD")).toBeNull();
    expect(parseAmount("-5", "USD")).toBeNull();
    expect(parseAmount("1.234", "USD")).toBeNull();
    expect(parseAmount("abc", "LBP")).toBeNull();
  });
});

describe("formatAmount", () => {
  it("formats both currencies", () => {
    expect(formatAmount(123456, "USD")).toBe("$1,234.56");
    expect(formatAmount(1500000, "LBP")).toBe("LBP 1,500,000");
  });
  it("shows sign as text", () => {
    expect(formatAmount(-500, "USD")).toBe("−$5.00");
    expect(formatAmount(500, "USD", { sign: true })).toBe("+$5.00");
  });
});

import { MAX_MINOR, MoneyRangeError, convertAtRate, groupTyped, parseRate, readMinor, sumMinor, toInputText } from "./money";

describe("SYP current-pound amounts", () => {
  it.each([
    ["12", 1200], ["12.5", 1250], ["0.01", 1], ["١٢٫٥٠", 1250],
    ["١٬٢٣٤٫٥٠", 123450], ["۱۲٫۵۰", 1250],
  ] as const)("parses %s as integer qirsh", (typed, expected) => {
    expect(parseAmount(typed, "SYP")).toBe(expected);
  });
  it.each(["", "-1", "12.345", "NaN", "10000000000000.01"])("rejects invalid SYP %s", (typed) => {
    expect(parseAmount(typed, "SYP")).toBeNull();
  });
  it("round-trips boundary qirsh without floating-point rounding", () => {
    for (const minor of [0, 1, 1250, MAX_MINOR - 1, MAX_MINOR]) {
      expect(parseAmount(toInputText(minor, "SYP"), "SYP")).toBe(minor);
    }
    expect(formatAmount(MAX_MINOR - 1, "SYP")).toBe("SYP 9,999,999,999,999.99");
    expect(formatAmount(1250, "SYP")).toBe("SYP 12.50");
    expect(formatAmount(-1250, "SYP")).toBe("−SYP 12.50");
    expect(formatAmount(1250, "SYP", { sign: true })).toBe("+SYP 12.50");
    expect(formatAmount(1250, "SYP", { digits: "arabic" })).toBe("SYP ١٢٫٥٠");
  });
  it.each(["USD", "LBP", "SYP"] as const)("never silently converts SYP to/from %s", (currency) => {
    expect(convertAtRate(1250, "SYP", currency, 89500)).toBeNull();
    expect(convertAtRate(1250, currency, "SYP", 89500)).toBeNull();
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
    expect(() => formatAmount(1.5, "SYP")).toThrow(MoneyRangeError);
  });
  it.each([0, -1, 1.5, NaN, Infinity, 10_000_001])("rejects invalid legacy rate %s without throwing", (rate) => {
    expect(convertAtRate(1250, "USD", "LBP", rate)).toBeNull();
  });
  it.each([-1, 1.5, NaN, Infinity, MAX_MINOR + 1, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid conversion input %s, including identity", (minor) => {
      expect(convertAtRate(minor, "USD", "LBP", 89500)).toBeNull();
      expect(convertAtRate(minor, "USD", "USD", 89500)).toBeNull();
    },
  );
});

describe("typed amounts", () => {
  it("round-trips minor units to input text", () => {
    expect(toInputText(5420, "USD")).toBe("54.2");
    expect(toInputText(5000, "USD")).toBe("50");
    expect(toInputText(5, "USD")).toBe("0.05");
    expect(toInputText(400000, "LBP")).toBe("400000");
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
  it("converts both ways with integer rounding", () => {
    expect(convertAtRate(10000, "USD", "LBP", 89500)).toBe(8_950_000);
    expect(convertAtRate(895_000, "LBP", "USD", 89500)).toBe(1000);
    expect(convertAtRate(1_000_000, "LBP", "USD", 89500)).toBe(1117);
    expect(convertAtRate(100, "LBP", "USD", 89500)).toBe(0);
    expect(convertAtRate(5000, "USD", "USD", 89500)).toBe(5000);
  });
  it("refuses results above the limit", () => {
    expect(convertAtRate(MAX_MINOR, "USD", "LBP", 89500)).toBeNull();
  });
});
