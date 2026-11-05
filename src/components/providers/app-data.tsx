"use client";

import { createContext, useContext, useMemo } from "react";
import type { Category } from "@/features/categories/schema";
import type { Wallet, WalletBalance, WalletContainer } from "@/features/wallets/schema";
import { DEFAULT_CURRENCIES, indexCurrencies, type CurrencyDefinition } from "@/lib/currency";
import { isCurrency } from "@/lib/money";

type AppData = {
  /** @deprecated Use walletContainers and exact balance IDs. */
  legacyWallets: Wallet[];
  /** Ordinary active wallets with enabled balances in catalog order. */
  walletContainers: WalletContainer[];
  currencies: CurrencyDefinition[];
  enabledCurrencies: CurrencyDefinition[];
  /** Complete historical catalogue. Use categoryOptions/activeCategories for new entries. */
  categories: Category[];
  timezone: string;
  salary: { amountMinor: number; walletId: string } | null;
  usdLbpRate: number | null;
  /** Complete canonical history, including disabled balances and tombstones. */
  walletById: (id: string) => WalletContainer | undefined;
  balanceById: (id: string) => WalletBalance | undefined;
  currencyByCode: (code: string) => CurrencyDefinition | undefined;
  /** @deprecated Task 9 migrates remaining money screens to walletById/balanceById. */
  legacyWalletById: (id: string) => Wallet | undefined;
  categoryById: (id: string) => Category | undefined;
};

const Context = createContext<AppData | null>(null);

/** Wallets and categories, loaded once per request by the app layout. */
export function AppDataProvider({
  wallets: legacyInput,
  walletContainers: containerInput,
  currencies: currencyInput,
  categories,
  timezone,
  salary,
  usdLbpRate,
  children,
}: {
  /** @deprecated Test/compatibility input; production passes walletContainers. */
  wallets?: Wallet[];
  walletContainers?: WalletContainer[];
  currencies?: CurrencyDefinition[];
  categories: Category[];
  timezone: string;
  salary: { amountMinor: number; walletId: string } | null;
  usdLbpRate: number | null;
  children: React.ReactNode;
}) {
  const value = useMemo<AppData>(() => {
    // Built-in defaults belong only to the transitional legacy input adapter.
    if (containerInput && !currencyInput) throw new Error("App currency data unavailable");
    const currencies = currencyInput ?? DEFAULT_CURRENCIES.map((currency) => ({ ...currency }));
    let currencyIndex: ReadonlyMap<string, CurrencyDefinition>;
    try {
      currencyIndex = indexCurrencies(currencies);
    } catch {
      throw new Error("App currency data unavailable");
    }
    const walletContainers = containerInput ?? (legacyInput ?? []).map((wallet): WalletContainer => ({
      id: wallet.id,
      name: wallet.name,
      kind: wallet.kind,
      position: wallet.position,
      deleted: wallet.archived,
      needsAttention: false,
      defaultBalanceId: wallet.id,
      balances: [{
        id: wallet.id,
        walletId: wallet.id,
        currency: wallet.currency,
        openingBalanceMinor: wallet.openingBalanceMinor,
        balanceMinor: wallet.balanceMinor,
        position: 0,
        detached: false,
      }],
    }));
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
    const legacyWallets = walletContainers.flatMap((wallet): Wallet[] => {
      const balance = wallet.defaultBalanceId === null ? undefined : balanceIndex.get(wallet.defaultBalanceId);
      if (!balance || !isCurrency(balance.currency)) return [];
      return [{
        id: wallet.id,
        name: wallet.name,
        kind: wallet.kind,
        currency: balance.currency,
        openingBalanceMinor: balance.openingBalanceMinor,
        balanceMinor: balance.balanceMinor,
        position: wallet.position,
        archived: wallet.deleted || wallet.needsAttention,
      }];
    });
    const legacyIndex = new Map(legacyWallets.map((wallet) => [wallet.id, wallet]));
    const c = new Map(categories.map((x) => [x.id, x]));
    return {
      legacyWallets,
      walletContainers: walletContainers.filter((wallet) => !wallet.deleted && !wallet.needsAttention).map((wallet) => ({
        ...wallet,
        balances: wallet.balances.filter((balance) => !balance.detached && !currencyIndex.get(balance.currency)!.disabled)
          .sort((left, right) => currencyOrder.get(left.currency)! - currencyOrder.get(right.currency)!),
      })),
      currencies,
      enabledCurrencies,
      categories,
      timezone,
      salary,
      usdLbpRate,
      walletById: (id) => walletIndex.get(id),
      balanceById: (id) => balanceIndex.get(id),
      currencyByCode: (code) => currencyIndex.get(code),
      legacyWalletById: (id) => legacyIndex.get(id),
      categoryById: (id) => c.get(id),
    };
  }, [legacyInput, containerInput, currencyInput, categories, timezone, salary, usdLbpRate]);
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
