import { dueThisCycle, type Installment } from "@/features/installments/cycle";
import type { Wallet } from "@/features/wallets/schema";
import { CURRENCIES, emptyCurrencyTotals, sumMinor, type Currency } from "@/lib/money";
import type { FixedExpense } from "./schema";

export type WalletNeed = {
  walletId: string;
  currency: Currency;
  /** Monthly fixed items plus current receipt-cycle installment targets. */
  totalMinor: number;
  /** The part not paid yet. */
  unpaidMinor: number;
  /** How much the wallet lacks to cover the unpaid part; 0 when it has enough. */
  shortMinor: number;
};

export type FixedSummary = {
  /** In wallet display order. */
  byWallet: WalletNeed[];
  total: Record<Currency, number>;
  /** Unpaid, per currency. */
  left: Record<Currency, number>;
  /** Salary minus the fixed total in the salary's own currency. Negative when short. */
  salaryAfter: { currency: Currency; minor: number; excludedCurrencies: Currency[] } | null;
};

/** Per-wallet needs, totals and salary left after fixed expenses. Currencies are never combined. */
export function summarizeFixed(
  items: readonly FixedExpense[],
  legacyWalletById: (id: string) => Wallet | undefined,
  salary: { amountMinor: number; walletId: string } | null,
  installments: readonly Installment[] = [],
): FixedSummary {
  const total = emptyCurrencyTotals();
  const left = emptyCurrencyTotals();
  const needs = new Map<string, WalletNeed & { position: number; balance: number }>();

  // Installment targets use actual salary cycles; fixed items keep their month.
  const lines = [
    ...items.map((item) => ({
      walletId: item.walletId,
      amountMinor: item.amountMinor,
      unpaid: item.paidOn === null ? item.amountMinor : 0,
    })),
    ...installments.map((i) => {
      const due = dueThisCycle(i);
      return { walletId: i.walletId, amountMinor: due, unpaid: Math.max(0, due - i.paidThisCycleMinor) };
    }),
  ].filter((line) => line.amountMinor > 0);

  for (const line of lines) {
    const wallet = legacyWalletById(line.walletId);
    if (!wallet) continue;
    const unpaid = line.unpaid;
    total[wallet.currency] = sumMinor([total[wallet.currency], line.amountMinor]);
    left[wallet.currency] = sumMinor([left[wallet.currency], unpaid]);
    const need = needs.get(wallet.id) ?? {
      walletId: wallet.id,
      currency: wallet.currency,
      totalMinor: 0,
      unpaidMinor: 0,
      shortMinor: 0,
      position: wallet.position,
      balance: wallet.balanceMinor,
    };
    need.totalMinor = sumMinor([need.totalMinor, line.amountMinor]);
    need.unpaidMinor = sumMinor([need.unpaidMinor, unpaid]);
    needs.set(wallet.id, need);
  }

  const byWallet = [...needs.values()]
    .sort((a, b) => a.position - b.position)
    .map((n) => ({
      walletId: n.walletId,
      currency: n.currency,
      totalMinor: n.totalMinor,
      unpaidMinor: n.unpaidMinor,
      shortMinor: Math.max(0, sumMinor([n.unpaidMinor, -n.balance])),
    }));

  const salaryWallet = salary ? legacyWalletById(salary.walletId) : undefined;
  let salaryAfter: FixedSummary["salaryAfter"] = null;
  if (salary && salaryWallet) {
    salaryAfter = {
      currency: salaryWallet.currency,
      minor: sumMinor([salary.amountMinor, -total[salaryWallet.currency]]),
      excludedCurrencies: CURRENCIES.filter((currency) => currency !== salaryWallet.currency && total[currency] > 0),
    };
  }
  return { byWallet, total, left, salaryAfter };
}
