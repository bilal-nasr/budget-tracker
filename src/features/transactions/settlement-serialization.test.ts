import { describe, expect, it } from "vitest";
import { MAX_MINOR } from "@/lib/money";
import { readSettlementSnapshot, serializeSettlement, settlementInputFromSnapshot, SettlementSnapshotError, type SettlementRow } from "./settlement-serialization";

const context = { kind: "expense", costCurrency: "USD" as const, payCurrency: "USD" as const, amountMinor: 1250 };
const usdWallet = "aaaaaaaa-0000-4000-8000-000000000001";
const lbpWallet = "aaaaaaaa-0000-4000-8000-000000000002";
const empty: SettlementRow = { tender_minor: null, cashier_changes: [] };
const rows = [
  { balance_id: usdWallet, amount_minor: "500", currency: "USD", position: 0, wallet_name_snapshot: null,
    rate_base: null, rate_quote: null, rate_numerator: null, rate_denominator: null },
  { balance_id: lbpWallet, amount_minor: "223750", currency: "LBP", position: 1, wallet_name_snapshot: null,
    rate_base: "USD", rate_quote: "LBP", rate_numerator: "89500", rate_denominator: "1" },
] as const;

describe("settlement row boundary", () => {
  it("requires a complete projection, with an explicit empty collection for plain transactions", () => {
    expect(readSettlementSnapshot(empty, context)).toBeNull();
    expect(() => readSettlementSnapshot({}, context)).toThrow(SettlementSnapshotError);
    expect(() => readSettlementSnapshot({ tender_minor: null, cashier_changes: undefined }, context)).toThrow(SettlementSnapshotError);
    expect(() => readSettlementSnapshot({ tender_minor: null, cashier_changes: rows }, context)).toThrow(SettlementSnapshotError);
  });

  it("decodes ordered USD and LBP change while preserving historical rate metadata", () => {
    const snapshot = readSettlementSnapshot({ tender_minor: "2000", cashier_changes: [...rows].reverse() }, context)!;
    expect(snapshot).toEqual({ tenderMinor: 2000, tenderCurrency: "USD", changes: [
      { balanceId: usdWallet, amountMinor: 500, currency: "USD" },
      { balanceId: lbpWallet, amountMinor: 223750, currency: "LBP",
        rate: { base: "USD", quote: "LBP", quoteMajorNumerator: 89500, quoteMajorDenominator: 1 } },
    ] });
    const input = settlementInputFromSnapshot(snapshot);
    expect(input.changes[0]).not.toHaveProperty("currency");
    expect(input.changes[0]).not.toHaveProperty("position");
    expect(serializeSettlement(input)).toEqual(input);
  });

  it("reads no-change and same-currency snapshots without inventing a rate", () => {
    expect(readSettlementSnapshot({ tender_minor: 1250, cashier_changes: [] }, context)).toEqual({ tenderMinor: 1250, tenderCurrency: "USD", changes: [] });
    expect(readSettlementSnapshot({ tender_minor: 2000, cashier_changes: [{ ...rows[0], amount_minor: "750" }] }, context))
      .toEqual({ tenderMinor: 2000, tenderCurrency: "USD", changes: [{ balanceId: usdWallet, amountMinor: 750, currency: "USD" }] });
  });

  it.each(["LBP", "SYP"] as const)("reads and serializes actual %s change without a quote", (currency) => {
    const snapshot = readSettlementSnapshot({ tender_minor: 2000, cashier_changes: [{ ...rows[0], balance_id: lbpWallet,
      amount_minor: 10000, currency }] }, context)!;
    expect(snapshot).toEqual({ tenderMinor: 2000, tenderCurrency: "USD", changes: [{ balanceId: lbpWallet, amountMinor: 10000, currency }] });
    expect(serializeSettlement(settlementInputFromSnapshot(snapshot))).toEqual({ tenderMinor: 2000,
      changes: [{ balanceId: lbpWallet, amountMinor: 10000 }] });
  });

  it("hydrates LBP purchase cost separately from its USD tender currency", () => {
    const snapshot = readSettlementSnapshot({ tender_minor: 500, cashier_changes: [{ ...rows[1],
      amount_minor: 110000, rate_base: null, rate_quote: null, rate_numerator: null, rate_denominator: null }] }, {
      kind: "expense", costCurrency: "LBP", payCurrency: "USD", amountMinor: 340000,
    });
    expect(snapshot).toEqual({ tenderMinor: 500, tenderCurrency: "USD", changes: [
      { balanceId: lbpWallet, amountMinor: 110000, currency: "LBP" },
    ] });
  });

  it("rejects unsafe, partial, duplicate-position, and malformed child data", () => {
    for (const value of ["9007199254740993", 9007199254740992, "1e3", "12.50", Infinity, MAX_MINOR + 1, {}, true]) {
      expect(() => readSettlementSnapshot({ tender_minor: value, cashier_changes: rows }, context)).toThrow(SettlementSnapshotError);
      expect(() => readSettlementSnapshot({ tender_minor: 2000, cashier_changes: [{ ...rows[1], rate_numerator: value }] }, context)).toThrow(SettlementSnapshotError);
    }
    expect(() => readSettlementSnapshot({ tender_minor: 2000, cashier_changes: [{ ...rows[0], currency: "invalid-code" }] }, context)).toThrow(SettlementSnapshotError);
    expect(() => readSettlementSnapshot({ tender_minor: 2000, cashier_changes: [{ ...rows[0], amount_minor: 0 }] }, context)).toThrow(SettlementSnapshotError);
    expect(() => readSettlementSnapshot({ tender_minor: 2000, cashier_changes: [{ ...rows[0], rate_denominator: 1 }] }, context)).toThrow(SettlementSnapshotError);
    expect(() => readSettlementSnapshot({ tender_minor: 2000, cashier_changes: [{ ...rows[0] }, { ...rows[1], position: 0 }] }, context)).toThrow(SettlementSnapshotError);
  });

  it("rejects inconsistent parents and invalid historical rate pairs", () => {
    expect(() => readSettlementSnapshot({ tender_minor: 2000, cashier_changes: [{ ...rows[0], amount_minor: 750 }] }, { ...context, amountMinor: 1251 })).toThrow(SettlementSnapshotError);
    expect(() => readSettlementSnapshot({ tender_minor: 2000, cashier_changes: rows }, { ...context, kind: "income" })).toThrow(SettlementSnapshotError);
    expect(() => readSettlementSnapshot({ tender_minor: 2000, cashier_changes: [{ ...rows[1], rate_base: "LBP" }] }, context)).toThrow(SettlementSnapshotError);
  });

  it("serializes omitted, removed, and entered settlement distinctly", () => {
    expect(serializeSettlement(undefined)).toBeNull();
    expect(serializeSettlement(null)).toEqual({});
    expect(serializeSettlement({ tenderMinor: 1250, changes: [] })).toEqual({ tenderMinor: 1250, changes: [] });
    expect(() => serializeSettlement({ tenderMinor: 0, changes: [] })).toThrow();
    expect(() => serializeSettlement({ tenderMinor: 1250, changes: [], currency: "USD" } as never)).toThrow();
  });
});

it("retains the original receiver snapshot but excludes it from all mutation payloads", () => {
  const snapshot = readSettlementSnapshot({ tender_minor: 2000, cashier_changes: [{ ...rows[0], amount_minor: 750, wallet_name_snapshot: "Original receiver" }] }, context)!;
  expect(snapshot.changes[0]).toMatchObject({ balanceId: usdWallet, amountMinor: 750, currency: "USD", walletNameSnapshot: "Original receiver" });
  expect(settlementInputFromSnapshot(snapshot).changes[0]).toEqual({ balanceId: usdWallet, amountMinor: 750 });
  expect(() => readSettlementSnapshot({ tender_minor: 2000, cashier_changes: [{ ...rows[0], amount_minor: 750, wallet_name_snapshot: 17 }] }, context)).toThrow(SettlementSnapshotError);
});
