// Kept free of zod so client components can import it without the validation library.
import { CURRENCIES, emptyCurrencyTotals, sumMinor, type Currency } from "@/lib/money";
import { indexCurrencies, type CurrencyDefinition } from "@/lib/currency";
import type { Wallet, WalletBalance, WalletContainer } from "./schema";

function checkedDefinitions(wallet: WalletContainer, definitions: readonly CurrencyDefinition[]) {
  const index = indexCurrencies(definitions);
  const ids = new Set<string>();
  const currencies = new Set<string>();
  for (const balance of wallet.balances) {
    if (balance.walletId !== wallet.id || ids.has(balance.id) || currencies.has(balance.currency)) {
      throw new RangeError(`Invalid wallet balance: ${balance.id}`);
    }
    if (!index.has(balance.currency)) throw new RangeError(`Missing currency definition: ${balance.currency}`);
    ids.add(balance.id);
    currencies.add(balance.currency);
  }
  return index;
}

/** Eligible balances display default first, then immutable addition order. */
export function attachedBalances(wallet: WalletContainer, definitions: readonly CurrencyDefinition[]): WalletBalance[] {
  const index = checkedDefinitions(wallet, definitions);
  return wallet.balances
    .filter((balance) => !balance.detached && !index.get(balance.currency)!.disabled)
    .sort((a, b) => Number(b.id === wallet.defaultBalanceId) - Number(a.id === wallet.defaultBalanceId) || a.position - b.position);
}

export function defaultBalance(wallet: WalletContainer, definitions: readonly CurrencyDefinition[]): WalletBalance {
  const selected = attachedBalances(wallet, definitions).find((balance) => balance.id === wallet.defaultBalanceId);
  if (!selected) throw new RangeError(`Invalid wallet default: ${wallet.defaultBalanceId}`);
  return selected;
}

/** Disable selects the next eligible balance in addition order, wrapping once. */
export function nextDefaultBalance(
  wallet: WalletContainer,
  disabledCode: string,
  definitions: readonly CurrencyDefinition[],
): WalletBalance | null {
  const index = checkedDefinitions(wallet, definitions);
  const ordered = [...wallet.balances].sort((a, b) => a.position - b.position);
  const start = ordered.findIndex((balance) => balance.currency === disabledCode);
  if (start === -1) throw new RangeError(`Wallet does not contain currency: ${disabledCode}`);
  for (let offset = 1; offset < ordered.length; offset++) {
    const balance = ordered[(start + offset) % ordered.length];
    if (!balance.detached && !index.get(balance.currency)!.disabled) return balance;
  }
  return null;
}

/** Totals per currency over active wallets. Never combines currencies. */
export function totalsByCurrency(wallets: readonly WalletContainer[], definitions: readonly CurrencyDefinition[]): Record<string, number>;
/** @deprecated Pass wallet containers and runtime definitions. */
export function totalsByCurrency(wallets: readonly Wallet[]): Record<Currency, number>;
export function totalsByCurrency(
  wallets: readonly Wallet[] | readonly WalletContainer[],
  definitions?: readonly CurrencyDefinition[],
): Record<string, number> {
  if (definitions) {
    const amounts = new Map(Array.from(indexCurrencies(definitions).keys(), (code) => [code, [] as number[]]));
    for (const wallet of wallets as readonly WalletContainer[]) {
      checkedDefinitions(wallet, definitions);
      if (wallet.deleted) continue;
      // Include historical/needs-attention rows: hiding them could hide real money.
      for (const balance of wallet.balances) amounts.get(balance.currency)!.push(balance.balanceMinor);
    }
    return Object.fromEntries(Array.from(amounts, ([code, values]) => [code, sumMinor(values)]));
  }
  const totals = emptyCurrencyTotals();
  for (const currency of CURRENCIES) {
    totals[currency] = sumMinor((wallets as readonly Wallet[]).filter((wallet) => !wallet.archived && wallet.currency === currency).map((wallet) => wallet.balanceMinor));
  }
  return totals;
}
