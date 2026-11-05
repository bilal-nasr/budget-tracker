import "server-only";

import { cache } from "react";
import { getCurrencies } from "@/features/currencies/queries";
import { DEMO_WALLET_CONTAINERS } from "@/lib/demo-data";
import { requireCurrency } from "@/lib/currency";
import { isCurrency, readMinor } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { walletContainerSchema, type Wallet, type WalletContainer } from "./schema";

export type WalletQueryOptions = {
  includeDeleted?: boolean;
  includeNeedsAttention?: boolean;
};

type BalanceRow = {
  id: string;
  wallet_id: string;
  currency: string;
  opening_balance_minor: number | string;
  position: number;
  detached_at: string | null;
  created_at: string;
};

type TotalRow = {
  balance_id: string;
  wallet_id: string;
  currency: string;
  balance_minor: number | string | null;
};

const getWalletsCached = cache(async (
  includeDeleted: boolean,
  includeNeedsAttention: boolean,
): Promise<WalletContainer[]> => {
  if (!supabaseConfigured()) return DEMO_WALLET_CONTAINERS;

  const supabase = await createClient();
  const [currencies, wallets, balances, totals] = await Promise.all([
    getCurrencies(),
    supabase.from("wallets")
      .select("id, name, kind, default_balance_id, position, deleted_at, needs_attention, created_at")
      .order("position")
      .order("created_at")
      .order("id"),
    supabase.from("wallet_balances")
      .select("id, wallet_id, currency, opening_balance_minor, position, detached_at, created_at")
      .order("position")
      .order("created_at")
      .order("id"),
    supabase.from("wallet_balance_totals")
      .select("balance_id, wallet_id, currency, balance_minor"),
  ]);

  if (wallets.error || !wallets.data) throw new Error("Wallet data unavailable");
  if (balances.error || !balances.data || totals.error || !totals.data) throw new Error("Wallet balances unavailable");

  const walletIds = new Set(wallets.data.map((wallet) => wallet.id));
  const totalByBalance = new Map<string, TotalRow>();
  for (const total of totals.data as TotalRow[]) {
    if (totalByBalance.has(total.balance_id)) throw new Error("Wallet balance total unavailable");
    totalByBalance.set(total.balance_id, total);
  }

  const balancesByWallet = new Map<string, WalletContainer["balances"]>();
  const balanceIds = new Set<string>();
  for (const row of balances.data as BalanceRow[]) {
    if (!walletIds.has(row.wallet_id) || balanceIds.has(row.id)) throw new Error("Invalid wallet data");
    balanceIds.add(row.id);
    requireCurrency(row.currency, currencies);
    const total = totalByBalance.get(row.id);
    if (!total || total.wallet_id !== row.wallet_id || total.currency !== row.currency || total.balance_minor === null) {
      throw new Error("Wallet balance total unavailable");
    }
    const mapped = {
      id: row.id,
      walletId: row.wallet_id,
      currency: row.currency,
      openingBalanceMinor: readMinor(row.opening_balance_minor),
      balanceMinor: readMinor(total.balance_minor),
      position: row.position,
      detached: row.detached_at !== null,
    };
    balancesByWallet.set(row.wallet_id, [...(balancesByWallet.get(row.wallet_id) ?? []), mapped]);
  }
  if (totalByBalance.size !== balanceIds.size || [...totalByBalance.keys()].some((id) => !balanceIds.has(id))) {
    throw new Error("Wallet balance total unavailable");
  }

  const mapped = wallets.data.map((row) => {
    const walletBalances = balancesByWallet.get(row.id) ?? [];
    walletBalances.sort((left, right) => {
      if (left.id === row.default_balance_id) return -1;
      if (right.id === row.default_balance_id) return 1;
      return left.position - right.position || left.id.localeCompare(right.id);
    });
    const selected = walletBalances.find((balance) => balance.id === row.default_balance_id);
    if (row.deleted_at === null && selected && requireCurrency(selected.currency, currencies).disabled) {
      throw new Error("Invalid wallet data");
    }
    const parsed = walletContainerSchema.safeParse({
      id: row.id,
      name: row.name,
      kind: row.kind,
      position: row.position,
      deleted: row.deleted_at !== null,
      needsAttention: row.needs_attention,
      defaultBalanceId: row.default_balance_id,
      balances: walletBalances,
    });
    if (!parsed.success) throw new Error("Invalid wallet data");
    return parsed.data;
  });

  return mapped.filter((wallet) =>
    (includeDeleted || !wallet.deleted)
    && (includeNeedsAttention || !wallet.needsAttention));
});

/** Nested wallet containers. Monetary callers must retain the exact balance IDs. */
export async function getWallets(options: WalletQueryOptions = {}): Promise<WalletContainer[]> {
  return getWalletsCached(options.includeDeleted === true, options.includeNeedsAttention === true);
}

/**
 * @deprecated Transitional default-balance-only adapter for the app layout and
 * budgets page. Task 4/9 migrate those consumers to `getWallets`.
 */
export async function getLegacyWallets(): Promise<Wallet[]> {
  return (await getWallets()).map((wallet) => {
    const balance = wallet.balances.find((candidate) => candidate.id === wallet.defaultBalanceId);
    if (!balance) throw new Error("Invalid wallet data");
    if (!isCurrency(balance.currency)) throw new Error("Legacy wallet currency unavailable");
    return {
      id: wallet.id,
      name: wallet.name,
      kind: wallet.kind,
      currency: balance.currency,
      openingBalanceMinor: balance.openingBalanceMinor,
      balanceMinor: balance.balanceMinor,
      position: wallet.position,
      archived: wallet.deleted || wallet.needsAttention,
    };
  });
}
