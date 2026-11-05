import { requireCurrency, SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
import { describe, expect, it } from "vitest";
import { applyKey } from "./amount-keypad";

describe("applyKey", () => {
  it("builds USD with two decimals max", () => {
    let v = "";
    for (const k of ["5", "4", ".", "2", "0"]) v = applyKey(v, k, requireCurrency("USD", SEED_CURRENCY_DEFINITIONS));
    expect(v).toBe("54.20");
    expect(applyKey(v, "1", requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe("54.20");
  });
  it("starts a decimal with a leading zero and ignores a second dot", () => {
    expect(applyKey("", ".", requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe("0.");
    expect(applyKey("1.5", ".", requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe("1.5");
  });
  it("does not allow decimals in LBP and supports 000", () => {
    expect(applyKey("5", ".", requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS))).toBe("5");
    expect(applyKey("400", "000", requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS))).toBe("400000");
    expect(applyKey("", "000", requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS))).toBe("");
  });
  it("replaces a lone zero and supports backspace", () => {
    expect(applyKey("0", "7", requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe("7");
    expect(applyKey("54.2", "back", requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe("54.");
    expect(applyKey("", "back", requireCurrency("USD", SEED_CURRENCY_DEFINITIONS))).toBe("");
  });
  it("uses whole-pound entry for SYP like LBP", () => {
    expect(applyKey("12", ".", requireCurrency("SYP", SEED_CURRENCY_DEFINITIONS))).toBe("12");
    expect(applyKey("12", "000", requireCurrency("SYP", SEED_CURRENCY_DEFINITIONS))).toBe("12000");
    expect(applyKey("1250", "back", requireCurrency("SYP", SEED_CURRENCY_DEFINITIONS))).toBe("125");
  });
});
