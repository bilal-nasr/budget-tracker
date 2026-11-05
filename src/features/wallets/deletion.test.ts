import { describe, expect, it } from "vitest";
import { buildWalletDeletionPlan, resolveWalletSettlements } from "./deletion";
import type { WalletContainer } from "./schema";
import type { CurrencyDefinition } from "@/lib/currency";

const currencies: CurrencyDefinition[] = [
  { code: "TOKEN", symbol: "◈", decimalPlaces: 8, disabled: false, firstUsed: true },
  { code: "JPY", symbol: "¥", decimalPlaces: 0, disabled: false, firstUsed: true },
  { code: "OLD", symbol: "old", decimalPlaces: 2, disabled: true, firstUsed: true },
];
function wallet(id: string, amounts = [0, 0, 0], extra: Partial<WalletContainer> = {}): WalletContainer {
  return { id, name: id, kind: "cash", position: 0, deleted: false, needsAttention: false, defaultBalanceId: `${id}-TOKEN`, balances: currencies.map((c, position) => ({ id: `${id}-${c.code}`, walletId: id, currency: c.code, position, balanceMinor: amounts[position], openingBalanceMinor: 0, detached: false })), ...extra };
}
describe("guided deletion exact balances", () => {
  it("allows a zero wallet without a counterpart and preserves all historical rows", () => {
    const source = wallet("source");
    const plan = buildWalletDeletionPlan(source.id, [source], currencies, []);
    expect(plan.lines).toEqual([]);
    expect(resolveWalletSettlements(plan, {})).toEqual(currencies.map((currency) => ({ balanceId: `source-${currency.code}`, counterpartBalanceId: null, expectedAmountMinor: 0, expectedUnit: { code: currency.code, decimalPlaces: currency.decimalPlaces } })));
    expect(source.balances).toHaveLength(3);
  });
  it("plans positive outgoing and negative incoming including a nondefault balance in catalog order", () => {
    const source = wallet("source", [123456789, -5, 0]);
    const plan = buildWalletDeletionPlan(source.id, [wallet("last", [0, 0, 0], { position: 2 }), source, wallet("first", [0, 0, 0], { position: 1 }), wallet("deleted", undefined, { deleted: true }), wallet("attention", undefined, { needsAttention: true })], currencies, []);
    expect(plan.lines.map((line) => [line.balanceId, line.amountMinor, line.direction, line.counterparts.map((other) => other.walletId)])).toEqual([
      ["source-TOKEN", 123456789, "out", ["first", "last"]], ["source-JPY", 5, "in", ["first", "last"]],
    ]);
    expect(resolveWalletSettlements(plan, { "source-TOKEN": "last", "source-JPY": "first" })).toEqual([
      { balanceId: "source-TOKEN", counterpartBalanceId: "last-TOKEN", expectedAmountMinor: 123456789, expectedUnit: { code: "TOKEN", decimalPlaces: 8 } }, { balanceId: "source-JPY", counterpartBalanceId: "first-JPY", expectedAmountMinor: -5, expectedUnit: { code: "JPY", decimalPlaces: 0 } }, { balanceId: "source-OLD", counterpartBalanceId: null, expectedAmountMinor: 0, expectedUnit: { code: "OLD", decimalPlaces: 2 } },
    ]);
  });
  it("allows Needs-attention recovery as source, never as counterpart", () => {
    const plan = buildWalletDeletionPlan("source", [wallet("source", [1, 0, 0], { needsAttention: true }), wallet("target")], currencies, []);
    expect(plan.needsAttention).toBe(true);
    expect(resolveWalletSettlements(plan, { "source-TOKEN": "target" })).toEqual([{ balanceId: "source-TOKEN", counterpartBalanceId: "target-TOKEN", expectedAmountMinor: 1, expectedUnit: { code: "TOKEN", decimalPlaces: 8 } }, { balanceId: "source-JPY", counterpartBalanceId: null, expectedAmountMinor: 0, expectedUnit: { code: "JPY", decimalPlaces: 0 } }, { balanceId: "source-OLD", counterpartBalanceId: null, expectedAmountMinor: 0, expectedUnit: { code: "OLD", decimalPlaces: 2 } }]);
  });
  it("blocks dependencies and absent counterparts instead of creating rows", () => {
    const plan = buildWalletDeletionPlan("source", [wallet("source", [1, 0, 0])], currencies, [{ kind: "salary", balanceId: "source-TOKEN" }]);
    expect(plan.blockers).toEqual([{ kind: "salary", balanceId: "source-TOKEN" }, { kind: "noCounterpart", balanceId: "source-TOKEN", currency: "TOKEN" }]);
    expect(resolveWalletSettlements(plan, {})).toBeNull();
  });
  it("rejects missing exact rows, unknown choices, incomplete selections and deleted sources", () => {
    expect(() => buildWalletDeletionPlan("source", [wallet("source", [1, 0, 0]), wallet("broken", undefined, { balances: [] })], currencies, [])).toThrow();
    expect(() => buildWalletDeletionPlan("source", [wallet("source", undefined, { deleted: true })], currencies, [])).toThrow();
    const plan = buildWalletDeletionPlan("source", [wallet("source", [1, 0, 0]), wallet("target")], currencies, []);
    expect(resolveWalletSettlements(plan, {})).toBeNull();
    expect(resolveWalletSettlements(plan, { "source-TOKEN": "source" })).toBeNull();
    expect(resolveWalletSettlements(plan, { "source-TOKEN": "target", forged: "target" })).toBeNull();
  });
  it("fails closed on a nonzero disabled balance", () => {
    const plan = buildWalletDeletionPlan("source", [wallet("source", [0, 0, 1]), wallet("target")], currencies, []);
    expect(plan.blockers).toContainEqual({ kind: "unavailableCurrency", balanceId: "source-OLD", currency: "OLD" });
    expect(resolveWalletSettlements(plan, {})).toBeNull();
  });
});
