import { describe, expect, it } from "vitest";
import { MAX_MINOR } from "@/lib/money";
import { readSettlementSnapshot, serializeSettlement, settlementInputFromSnapshot, SettlementSnapshotError, type SettlementRow } from "./settlement-serialization";

const empty: SettlementRow = {
  tender_minor: null, change_wallet_id: null, change_minor: null, change_currency: null,
  change_rate_base: null, change_rate_quote: null, change_rate_numerator: null, change_rate_denominator: null,
};
const context = { kind: "expense", currency: "USD" as const, amountMinor: 1250 };
const walletId = "aaaaaaaa-0000-4000-8000-000000000001";
const row: SettlementRow = { tender_minor: "2000", change_wallet_id: walletId, change_minor: "671250", change_currency: "LBP", change_rate_base: "USD", change_rate_quote: "LBP", change_rate_numerator: "89500", change_rate_denominator: "1" };
describe("settlement row boundary", () => {
  it("requires a complete projection, with explicit nulls for plain transactions", () => {
    expect(readSettlementSnapshot(empty, context)).toBeNull();
    expect(() => readSettlementSnapshot({}, context)).toThrow(SettlementSnapshotError);
    expect(() => readSettlementSnapshot({ ...empty, change_minor: undefined }, context)).toThrow(SettlementSnapshotError);
    expect(() => readSettlementSnapshot({ ...empty, change_minor: 750 }, context)).toThrow(SettlementSnapshotError);
  });
  it("decodes exact database integers and preserves change currency in history", () => {
    const snapshot = readSettlementSnapshot(row, context)!;
    expect(snapshot).toEqual({ tenderMinor: 2000, change: { walletId, amountMinor: 671250, currency: "LBP", rate: { base: "USD", quote: "LBP", quoteMajorNumerator: 89500, quoteMajorDenominator: 1 } } });
    const input = settlementInputFromSnapshot(snapshot);
    expect(input.change).not.toHaveProperty("currency");
    expect(serializeSettlement(input)).toEqual(input);
    expect(JSON.stringify(input)).not.toContain("671250n");
  });
  it("reads no-change and same-currency snapshots without inventing a rate", () => {
    expect(readSettlementSnapshot({ ...empty, tender_minor: 1250 }, context)).toEqual({ tenderMinor: 1250, change: null });
    expect(readSettlementSnapshot({ ...empty, tender_minor: 2000, change_wallet_id: walletId, change_minor: "750", change_currency: "USD" }, context)).toEqual({ tenderMinor: 2000, change: { walletId, amountMinor: 750, currency: "USD" } });
  });
  it("rejects unsafe or malformed numeric data before Number can round it", () => {
    for (const value of ["9007199254740993", 9007199254740992, "1e3", "12.50", Infinity, MAX_MINOR + 1, {}, true]) {
      expect(() => readSettlementSnapshot({ ...row, tender_minor: value }, context)).toThrow(SettlementSnapshotError);
      expect(() => readSettlementSnapshot({ ...row, change_rate_numerator: value }, context)).toThrow(SettlementSnapshotError);
    }
  });
  it("rejects partial rate shapes, mismatched pairs, invalid currency and wrong cost", () => {
    for (const patch of [{ change_rate_denominator: null }, { change_rate_base: "LBP" }, { change_currency: "EUR" }, { change_wallet_id: "invalid" }, { change_minor: 0 }]) {
      expect(() => readSettlementSnapshot({ ...row, ...patch }, context)).toThrow(SettlementSnapshotError);
    }
    expect(() => readSettlementSnapshot(row, { ...context, amountMinor: 1251 })).toThrow(SettlementSnapshotError);
    expect(() => readSettlementSnapshot(row, { ...context, kind: "income" })).toThrow(SettlementSnapshotError);
  });
  it("decodes SYP qirsh with its direct rate snapshot", () => {
    const snapshot = readSettlementSnapshot({ ...row, change_currency: "SYP", change_minor: "9750000", change_rate_quote: "SYP", change_rate_numerator: "13000" }, context)!;
    expect(snapshot.change?.amountMinor).toBe(9750000);
    expect(snapshot.change?.currency).toBe("SYP");
  });
  it("serializes omitted, removed, and entered settlement distinctly", () => {
    expect(serializeSettlement(undefined)).toBeNull();
    expect(serializeSettlement(null)).toEqual({});
    expect(serializeSettlement({ tenderMinor: 1250, change: null })).toEqual({ tenderMinor: 1250, change: null });
    expect(() => serializeSettlement({ tenderMinor: 0, change: null })).toThrow();
    expect(() => serializeSettlement({ tenderMinor: 1250, change: null, currency: "USD" } as never)).toThrow();
  });
});
