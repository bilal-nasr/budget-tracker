import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
import type { WalletContainer, WalletKind } from "@/features/wallets/schema";
export type BalanceFixture = { id: string; name: string; kind: WalletKind; currency: string; openingBalanceMinor: number; balanceMinor: number; position: number; archived: boolean };
export function completeFixtureWallets(rows: readonly BalanceFixture[]): WalletContainer[] {
 return rows.map((row, walletIndex) => ({ id: row.id, name: row.name, kind: row.kind, position: row.position, deleted: row.archived, needsAttention: false, defaultBalanceId: row.id,
  balances: SEED_CURRENCY_DEFINITIONS.map((definition, position) => ({ id: definition.code === row.currency ? row.id : `10000000-0000-4000-8000-${String(walletIndex * 10 + position).padStart(12, "0")}`, walletId: row.id, currency: definition.code, openingBalanceMinor: definition.code === row.currency ? row.openingBalanceMinor : 0, balanceMinor: definition.code === row.currency ? row.balanceMinor : 0, position, detached: false })) }));
}
