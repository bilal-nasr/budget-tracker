import { requireCurrency, SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
import { describe, expect, it } from "vitest";
import { normalizeNumericDigits, parseOptionalDay } from "./numeric-text";
import { MAX_MINOR, parseAmount, parseRate } from "./money";

describe("normalizeNumericDigits", () => {
  it.each([
    ["0123456789", "0123456789"],
    ["٠١٢٣٤٥٦٧٨٩", "0123456789"],
    ["۰۱۲۳۴۵۶۷۸۹", "0123456789"],
    ["1٢۳", "123"],
    [" ١٬٢٫٣,۴.٥ x ", " 1٬2٫3,4.5 x "],
  ])("maps digits without deleting other draft characters: %s", (input, expected) => {
    expect(normalizeNumericDigits(input)).toBe(expected);
    expect(normalizeNumericDigits(input)).toHaveLength(input.length);
  });
});

describe("parseOptionalDay", () => {
  it.each(["", " ", "\t\n"])("keeps empty input optional: %j", (input) => {
    expect(parseOptionalDay(input)).toEqual({ value: null, invalid: false });
  });
  it.each([
    ["1", 1], ["01", 1], ["٣١", 31], ["۳۱", 31], ["1٢", 12], [" ١٢ ", 12],
  ])("parses a complete day without changing the draft: %s", (input, value) => {
    expect(parseOptionalDay(input)).toEqual({ value, invalid: false });
  });
  it.each(["0", "٠", "32", "٣٢", "031", "1x2", "1.2", "١٫٢", "-1", "+1", "1,2", "١٬٢", "1 2"])(
    "rejects rather than strips/truncates invalid text: %s", (input) => {
      expect(parseOptionalDay(input)).toEqual({ value: null, invalid: true });
    },
  );
});

describe("numeric keyboard scripts at the money parsing boundary", () => {
  it.each(["12.50", "١٢٫٥٠", "۱۲٫۵۰", "1٢٫۵0"])("parses %s to exact USD cents", (text) => {
    expect(parseAmount(text, requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe(1250);
  });
  it.each(["1,500", "١٬٥٠٠", "۱٬۵۰۰"])("keeps LBP grouping semantics for %s", (text) => {
    expect(parseAmount(text, requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS))).toBe(1500);
  });
  it.each(["89500", "٨٩٥٠٠", "۸۹۵۰۰"])("parses the whole-number reference rate %s", (text) => {
    expect(parseRate(text)).toBe(89500);
  });
  it("retains validation, precision limits and comma grouping", () => {
    for (const text of ["", ".", "٫", "0.", "٠٫", "12.", "١٢٫", "-1", "١x٢", "1.234"]) {
      expect(parseAmount(text, requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBeNull();
    }
    expect(parseAmount("١٫٢", requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS))).toBeNull();
    expect(parseAmount("1,200", requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe(120000);
    expect(parseAmount(String(MAX_MINOR), requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS))).toBe(MAX_MINOR);
    expect(parseAmount(String(MAX_MINOR + 1), requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS))).toBeNull();
    expect(parseRate("۸۹۵۰۰٫۵")).toBeNull();
  });
});
