import { expect, it } from "vitest";
import { historicalExportBalances } from "./model";
import type { WalletContainer } from "@/features/wallets/schema";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
const wallet: WalletContainer = { id: "container", name: "Deleted wallet", kind: "cash", position: 2, deleted: true, needsAttention: false, defaultBalanceId: "default-usd", balances: [
  { id: "default-usd", walletId: "container", currency: "USD", openingBalanceMinor: 100, balanceMinor: 0, position: 0, detached: false },
  { id: "nondefault-lbp", walletId: "container", currency: "LBP", openingBalanceMinor: -5, balanceMinor: 0, position: 1, detached: true },
] };
it("exports exact balances with independent container IDs and retained metadata", () => {
  expect(historicalExportBalances([wallet], SEED_CURRENCY_DEFINITIONS)).toMatchObject([
    { id: "default-usd", walletId: "container", defaultBalanceId: "default-usd", name: "Deleted wallet", currency: "USD", openingBalanceMinor: 100, balanceMinor: 0, archived: true, deleted: true, needsAttention: false, detached: false },
    { id: "nondefault-lbp", walletId: "container", currency: "LBP", openingBalanceMinor: -5, balanceMinor: 0, detached: true },
  ]);
});
it("exports custom and changed built-in precision using runtime definitions", () => {
  const catalog = [...SEED_CURRENCY_DEFINITIONS.map((row) => ({ ...row, decimalPlaces: row.code === "USD" ? 8 : row.decimalPlaces })), { code: "TOKEN", symbol: "🪙", decimalPlaces: 8, disabled: true, firstUsed: true }];
  expect(historicalExportBalances([{ ...wallet, balances: [...wallet.balances, { ...wallet.balances[1], id: "custom", currency: "TOKEN" }] }], catalog)).toHaveLength(3);
});
it("fails closed for a missing definition", () => {
  expect(() => historicalExportBalances([wallet], [])).toThrow("export_data_unavailable");
});
