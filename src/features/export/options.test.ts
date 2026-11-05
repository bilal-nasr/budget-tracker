import { describe, expect, it } from "vitest";
import { DEFAULT_DETAILED, DEFAULT_SIMPLE, SECTION_GROUPS, exportQuery, parseExportOptions, selectedSheets } from "./options";

const parse = (query: string) => parseExportOptions(new URLSearchParams(query));

describe("export options", () => {
  it("defaults to the full detailed workbook when no parameters are sent", () => {
    expect(parse("")).toEqual(DEFAULT_DETAILED);
    expect(parse("mode=detailed")).toEqual(DEFAULT_DETAILED);
  });

  it("parses a section selection in canonical order and ignores duplicates", () => {
    expect(parse("mode=detailed&sections=debts,transactions,debts")).toEqual({ mode: "detailed", sections: ["transactions", "debts"] });
  });

  it("rejects unknown or empty selections instead of guessing", () => {
    expect(parse("sections=transactions,payroll")).toBeNull();
    expect(parse("mode=detailed&sections=")).toBeNull();
    expect(parse("mode=pdf")).toBeNull();
  });

  it("parses simple options with defaults and rejects bad values", () => {
    expect(parse("mode=simple")).toEqual(DEFAULT_SIMPLE);
    expect(parse("mode=simple&period=all&balances=0&notes=1")).toEqual({ mode: "simple", period: "all", balances: false, notes: true });
    expect(parse("mode=simple&period=year")).toBeNull();
    expect(parse("mode=simple&balances=yes")).toBeNull();
  });

  it("round-trips through the query string", () => {
    for (const options of [DEFAULT_DETAILED, { mode: "detailed", sections: ["wallets", "audit"] } as const, DEFAULT_SIMPLE,
      { mode: "simple", period: "month", balances: false, notes: false } as const]) {
      expect(parse(exportQuery(options))).toEqual(options);
    }
  });

  it("always keeps the cover and maps each group to its sheets", () => {
    expect([...selectedSheets([])]).toEqual(["cover"]);
    expect(selectedSheets(["debts"]).has("loans")).toBe(true);
    expect(selectedSheets(SECTION_GROUPS).size).toBe(22);
  });
});
