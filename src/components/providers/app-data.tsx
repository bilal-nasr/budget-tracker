"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { Category } from "@/features/categories/schema";
import type { WalletBalance, WalletContainer } from "@/features/wallets/schema";
import { indexCurrencies, type CurrencyDefinition } from "@/lib/currency";
import { applyWalletOrder, reconcileWalletOrder } from "@/features/wallets/reorder";

type AppData = {
  /** Ordinary active wallets with enabled balances in catalog order. */
  walletContainers: WalletContainer[];
  /** Shared temporary order; fresh server data remains authoritative. */
  setWalletOrder: (ids: string[] | null) => void;
  /** Identity of the authoritative input, independent of temporary reorder previews. */
  walletOrderSource: object | undefined;
  /** Recovery-only wallets, excluded from ordinary actions. */
  needsAttentionWallets: WalletContainer[];
  currencies: CurrencyDefinition[];
  enabledCurrencies: CurrencyDefinition[];
  /** Complete historical catalogue. Use categoryOptions/activeCategories for new entries. */
  categories: Category[];
  timezone: string;
  salary: { amountMinor: number; balanceId: string } | null;
  usdLbpRate: number | null;
  /** Complete canonical history, including disabled balances and tombstones. */
  walletById: (id: string) => WalletContainer | undefined;
  balanceById: (id: string) => WalletBalance | undefined;
  currencyByCode: (code: string) => CurrencyDefinition | undefined;
  categoryById: (id: string) => Category | undefined;
};

const Context = createContext<AppData | null>(null);

/** Wallets and categories, loaded once per request by the app layout. */
export function AppDataProvider({
  walletContainers: containerInput,
  currencies: currencyInput,
  categories,
  timezone,
  salary,
  usdLbpRate,
  children,
}: {
  walletContainers: WalletContainer[];
  currencies: CurrencyDefinition[];
  categories: Category[];
  timezone: string;
  salary: { amountMinor: number; balanceId: string } | null;
  usdLbpRate: number | null;
  children: React.ReactNode;
}) {
  const source = containerInput;
  const [order, setOrder] = useState<{ source: typeof source; ids: string[] | null }>({ source, ids: null });
  const orderIds = order.source === source ? order.ids : null;
  const value = useMemo<AppData>(() => {
    if (containerInput && !currencyInput) throw new Error("App currency data unavailable");
    const currencies = currencyInput;
    let currencyIndex: ReadonlyMap<string, CurrencyDefinition>;
    try {
      currencyIndex = indexCurrencies(currencies);
    } catch {
      throw new Error("App currency data unavailable");
    }
    const walletContainers = [...containerInput].sort((left, right) => left.position - right.position);
    const ordinaryWallets = walletContainers.filter((wallet) => !wallet.deleted && !wallet.needsAttention);
    const orderedOrdinary = reconcileWalletOrder(ordinaryWallets, orderIds);
    const walletIndex = new Map<string, WalletContainer>();
    const balanceIndex = new Map<string, WalletBalance>();
    const enabledCurrencies = currencies.filter((currency) => !currency.disabled);
    const currencyOrder = new Map(currencies.map((currency, index) => [currency.code, index]));
    for (const wallet of walletContainers) {
      if (walletIndex.has(wallet.id)) throw new Error("App wallet data unavailable");
      walletIndex.set(wallet.id, wallet);
      const balanceCurrencies = new Set<string>();
      for (const balance of wallet.balances) {
        if (balance.walletId !== wallet.id || balanceIndex.has(balance.id)) throw new Error("App wallet data unavailable");
        if (!currencyIndex.has(balance.currency)) throw new Error("App currency data unavailable");
        if (balanceCurrencies.has(balance.currency)) throw new Error("App wallet data unavailable");
        balanceCurrencies.add(balance.currency);
        if (containerInput && !wallet.deleted && balance.detached && !currencyIndex.get(balance.currency)!.disabled) throw new Error("App wallet data unavailable");
        balanceIndex.set(balance.id, balance);
      }
      const emptyTombstone = wallet.deleted && wallet.defaultBalanceId === null && wallet.balances.length === 0;
      if (!emptyTombstone && !wallet.balances.some((balance) => balance.id === wallet.defaultBalanceId)) throw new Error("App wallet data unavailable");
      if (containerInput && !wallet.deleted) {
        const defaultBalance = wallet.balances.find((balance) => balance.id === wallet.defaultBalanceId);
        if (!defaultBalance || defaultBalance.detached || currencyIndex.get(defaultBalance.currency)!.disabled
          || enabledCurrencies.some((currency) => !balanceCurrencies.has(currency.code))) throw new Error("App wallet data unavailable");
      }
    }
    const c = new Map(categories.map((x) => [x.id, x]));
    const projectEnabledBalances = (wallet: WalletContainer): WalletContainer => ({
      ...wallet,
      balances: wallet.balances.filter((balance) => !balance.detached && !currencyIndex.get(balance.currency)!.disabled)
        .sort((left, right) => currencyOrder.get(left.currency)! - currencyOrder.get(right.currency)!),
    });
    return {
      walletContainers: orderedOrdinary.map(projectEnabledBalances),
      walletOrderSource: source,
      setWalletOrder: (ids) => {
        if (ids === null || applyWalletOrder(ordinaryWallets, ids)) setOrder({ source, ids });
      },
      needsAttentionWallets: walletContainers.filter((wallet) => !wallet.deleted && wallet.needsAttention).map(projectEnabledBalances),
      currencies,
      enabledCurrencies,
      categories,
      timezone,
      salary,
      usdLbpRate,
      walletById: (id) => walletIndex.get(id),
      balanceById: (id) => balanceIndex.get(id),
      currencyByCode: (code) => currencyIndex.get(code),
      categoryById: (id) => c.get(id),
    };
  }, [containerInput, currencyInput, categories, timezone, salary, usdLbpRate, source, orderIds]);
  return <Context value={value}>{children}</Context>;
}

/** Like useAppData, but null outside the app shell (for example during onboarding). */
export function useAppDataOptional(): AppData | null {
  return useContext(Context);
}

export function useAppData(): AppData {
  const value = useContext(Context);
  if (!value) throw new Error("useAppData must be used inside AppDataProvider");
  return value;
}
