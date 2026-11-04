import { describe, expect, it } from "vitest";
import { applyKey } from "./amount-keypad";

describe("applyKey", () => {
  it("builds USD with two decimals max", () => {
    let v = "";
    for (const k of ["5", "4", ".", "2", "0"]) v = applyKey(v, k, "USD");
    expect(v).toBe("54.20");
    expect(applyKey(v, "1", "USD")).toBe("54.20");
  });
  it("starts a decimal with a leading zero and ignores a second dot", () => {
    expect(applyKey("", ".", "USD")).toBe("0.");
    expect(applyKey("1.5", ".", "USD")).toBe("1.5");
  });
  it("does not allow decimals in LBP and supports 000", () => {
    expect(applyKey("5", ".", "LBP")).toBe("5");
    expect(applyKey("400", "000", "LBP")).toBe("400000");
    expect(applyKey("", "000", "LBP")).toBe("");
  });
  it("replaces a lone zero and supports backspace", () => {
    expect(applyKey("0", "7", "USD")).toBe("7");
    expect(applyKey("54.2", "back", "USD")).toBe("54.");
    expect(applyKey("", "back", "USD")).toBe("");
  });
  it("uses whole-pound entry for SYP like LBP", () => {
    expect(applyKey("12", ".", "SYP")).toBe("12");
    expect(applyKey("12", "000", "SYP")).toBe("12000");
    expect(applyKey("1250", "back", "SYP")).toBe("125");
  });
});
