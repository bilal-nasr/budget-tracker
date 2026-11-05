import type { WalletContainer } from "@/features/wallets/schema";
import type { BalanceFixture } from "@/test/balance-fixtures";
/** Existing accounting examples each use a single balance; give both identities explicitly. */
export function singleBalanceWallets(rows: readonly BalanceFixture[]): WalletContainer[] {
  return rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind, position: row.position,
    deleted: row.archived, needsAttention: false, defaultBalanceId: row.id,
    balances: [{ id: row.id, walletId: row.id, currency: row.currency, openingBalanceMinor: row.openingBalanceMinor,
      balanceMinor: row.balanceMinor, position: 0, detached: false }] }));
}
