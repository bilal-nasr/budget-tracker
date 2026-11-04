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
  it("uses decimal qirsh entry for SYP and preserves a partial draft", () => {
    let value = "";
    for (const key of ["1", "2", ".", "5", "0"]) value = applyKey(value, key, "SYP");
    expect(value).toBe("12.50");
    expect(applyKey(value, "1", "SYP")).toBe("12.50");
    expect(applyKey("12.5", "back", "SYP")).toBe("12.");
  });
});
