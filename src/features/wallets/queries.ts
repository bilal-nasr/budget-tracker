import "server-only";

import { cache } from "react";
import { getCurrencies } from "@/features/currencies/queries";
import { DEMO_WALLET_CONTAINERS } from "@/lib/demo-data";
import { indexCurrencies, requireCurrency, type CurrencyDefinition } from "@/lib/currency";
import { readMinor } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { readAllByKey } from "@/lib/supabase/read-all";
import { compareTimestamps } from "@/lib/timestamp";
import { walletContainerSchema, type WalletContainer } from "./schema";

export type WalletQueryOptions = {
  includeDeleted?: boolean;
  includeNeedsAttention?: boolean;
  includeDisabledBalances?: boolean;
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
  includeDisabledBalances: boolean,
): Promise<WalletContainer[]> => {
  if (!supabaseConfigured()) {
    return projectWallets(DEMO_WALLET_CONTAINERS, await getCurrencies(), {
      includeDeleted, includeNeedsAttention, includeDisabledBalances,
    });
  }

  const supabase = await createClient();
  const [currencies, wallets, balances, totals] = await Promise.all([
    getCurrencies(),
    readAllByKey(async (after, limit) => {
      let query = supabase.from("wallets")
      .select("id, name, kind, default_balance_id, position, deleted_at, needs_attention, created_at")
      .order("id").limit(limit);
      if (after !== null) query = query.gt("id", after);
      return query;
    }, (row) => row.id, "Wallet data unavailable"),
    readAllByKey(async (after, limit) => {
      let query = supabase.from("wallet_balances")
      .select("id, wallet_id, currency, opening_balance_minor, position, detached_at, created_at")
      .order("id").limit(limit);
      if (after !== null) query = query.gt("id", after);
      return query;
    }, (row) => row.id, "Wallet balances unavailable"),
    readAllByKey(async (after, limit) => {
      let query = supabase.from("wallet_balance_totals")
        .select("balance_id, wallet_id, currency, balance_minor").order("balance_id").limit(limit);
      if (after !== null) query = query.gt("balance_id", after);
      const result = await query;
      if (result.error || !result.data) throw new Error("Wallet balances unavailable");
      return result;
    }, (row) => row.balance_id, "Wallet balance total unavailable"),
  ]);
  wallets.sort((a, b) => a.position - b.position || compareTimestamps(a.created_at, b.created_at) || a.id.localeCompare(b.id));
  const walletIds = new Set(wallets.map((wallet) => wallet.id));
  const totalByBalance = new Map<string, TotalRow>();
  for (const total of totals as TotalRow[]) {
    if (totalByBalance.has(total.balance_id)) throw new Error("Wallet balance total unavailable");
    totalByBalance.set(total.balance_id, total);
  }

  const balancesByWallet = new Map<string, WalletContainer["balances"]>();
  const balanceIds = new Set<string>();
  for (const row of balances as BalanceRow[]) {
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

  const mapped = wallets.map((row) => {
    const walletBalances = balancesByWallet.get(row.id) ?? [];
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

  return projectWallets(mapped, currencies, { includeDeleted, includeNeedsAttention, includeDisabledBalances });
});

/**
 * Validate complete stored state before applying independent visibility options.
 * Deleted wallets never require later catalog additions. A hidden disabled default
 * retains its stored ID; full history callers must include disabled balances.
 */
function projectWallets(
  stored: readonly WalletContainer[],
  currencies: readonly CurrencyDefinition[],
  options: WalletQueryOptions,
): WalletContainer[] {
  const catalog = indexCurrencies(currencies);
  const order = new Map(currencies.map((currency, index) => [currency.code, index]));
  const walletIds = new Set<string>();
  const balanceIds = new Set<string>();
  const validated = stored.map((input) => {
    const parsed = walletContainerSchema.safeParse(input);
    if (!parsed.success || walletIds.has(input.id)) throw new Error("Invalid wallet data");
    const wallet = parsed.data;
    walletIds.add(wallet.id);
    for (const balance of wallet.balances) {
      requireCurrency(balance.currency, currencies);
      if (balanceIds.has(balance.id)) throw new Error("Invalid wallet data");
      balanceIds.add(balance.id);
      if (!wallet.deleted && !catalog.get(balance.currency)!.disabled && balance.detached) {
        throw new Error("Invalid wallet data");
      }
    }
    if (!wallet.deleted) {
      const selected = wallet.balances.find((balance) => balance.id === wallet.defaultBalanceId);
      if (!selected || catalog.get(selected.currency)!.disabled
        || currencies.some((currency) => !currency.disabled && !wallet.balances.some((balance) => balance.currency === currency.code))) {
        throw new Error("Invalid wallet data");
      }
    }
    return wallet;
  });
  return validated
    .filter((wallet) => (options.includeDeleted || !wallet.deleted) && (options.includeNeedsAttention || !wallet.needsAttention))
    .map((wallet) => ({
      ...wallet,
      balances: wallet.balances
        .filter((balance) => options.includeDisabledBalances || !catalog.get(balance.currency)!.disabled)
        .sort((left, right) => order.get(left.currency)! - order.get(right.currency)!),
    }));
}

/** Nested wallet containers. Monetary callers must retain the exact balance IDs. */
export async function getWallets(options: WalletQueryOptions = {}): Promise<WalletContainer[]> {
  return getWalletsCached(options.includeDeleted === true, options.includeNeedsAttention === true, options.includeDisabledBalances === true);
}
