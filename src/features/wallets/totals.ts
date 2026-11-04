// Kept free of zod so client components can import it without the validation library.
import { CURRENCIES, emptyCurrencyTotals, sumMinor, type Currency } from "@/lib/money";
import type { Wallet } from "./schema";

/** Totals per currency over active wallets. Never combines currencies. */
export function totalsByCurrency(wallets: readonly Wallet[]): Record<Currency, number> {
  const totals = emptyCurrencyTotals();
  for (const currency of CURRENCIES) {
    totals[currency] = sumMinor(wallets.filter((wallet) => !wallet.archived && wallet.currency === currency).map((wallet) => wallet.balanceMinor));
  }
  return totals;
}
