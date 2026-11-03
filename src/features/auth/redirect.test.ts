import { describe, expect, it } from "vitest";
import { safeNext, siteBase } from "./redirect";

describe("safeNext", () => {
  it("keeps same-site locale paths", () => {
    expect(safeNext("/ar/onboarding")).toBe("/ar/onboarding");
    expect(safeNext("/en")).toBe("/en");
  });
  it("rejects other sites and tricks", () => {
    expect(safeNext("//evil.com")).toBe("/en");
    expect(safeNext("https://evil.com")).toBe("/en");
    expect(safeNext("https://evil.com/en/onboarding", "https://app.example")).toBe("/en");
    expect(safeNext("/en/../x")).toBe("/en");
    expect(safeNext("/fr/onboarding")).toBe("/en");
    expect(safeNext("/en/onboarding?x=//evil.com")).toBe("/en");
    expect(safeNext("javascript:alert(1)")).toBe("/en");
    expect(safeNext(null)).toBe("/en");
    expect(safeNext("")).toBe("/en");
  });
  it("reduces a full URL on our own origin to its path", () => {
    expect(safeNext("https://app.example/ar/onboarding", "https://app.example")).toBe("/ar/onboarding");
    expect(safeNext("https://app.example/ar/onboarding")).toBe("/en");
  });
});

describe("siteBase", () => {
  it("prefers the configured public address over the request origin", () => {
    expect(siteBase("https://budget.example.com", "http://localhost:3000")).toBe("https://budget.example.com");
    expect(siteBase("https://budget.example.com/", "http://localhost:3000")).toBe("https://budget.example.com");
  });
  it("falls back to the request origin when unset or invalid", () => {
    expect(siteBase(undefined, "http://localhost:3000")).toBe("http://localhost:3000");
    expect(siteBase("  ", "http://localhost:3000")).toBe("http://localhost:3000");
    expect(siteBase("not a url", "http://localhost:3000")).toBe("http://localhost:3000");
  });
});
