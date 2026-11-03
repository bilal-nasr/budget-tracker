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

import { groupTyped, toInputText } from "./money";

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
