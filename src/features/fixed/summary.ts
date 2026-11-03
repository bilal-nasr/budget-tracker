import { dueThisMonth, type Installment } from "@/features/installments/schema";
import type { Wallet } from "@/features/wallets/schema";
import type { Currency } from "@/lib/money";
import type { FixedExpense } from "./schema";

export type WalletNeed = {
  walletId: string;
  currency: Currency;
  /** All fixed items on this wallet this month, paid or not. */
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
  salaryAfter: { currency: Currency; minor: number; excludesOther: boolean } | null;
};

/** Per-wallet needs, totals and salary left after fixed expenses. Currencies are never combined. */
export function summarizeFixed(
  items: readonly FixedExpense[],
  walletById: (id: string) => Wallet | undefined,
  salary: { amountMinor: number; walletId: string } | null,
  installments: readonly Installment[] = [],
): FixedSummary {
  const total: Record<Currency, number> = { USD: 0, LBP: 0 };
  const left: Record<Currency, number> = { USD: 0, LBP: 0 };
  const needs = new Map<string, WalletNeed & { position: number; balance: number }>();

  // Installments count as their monthly amount, on their default wallet.
  const lines = [
    ...items.map((item) => ({
      walletId: item.walletId,
      amountMinor: item.amountMinor,
      unpaid: item.paidOn === null ? item.amountMinor : 0,
    })),
    ...installments.map((i) => {
      const due = dueThisMonth(i);
      return { walletId: i.walletId, amountMinor: due, unpaid: Math.max(0, due - i.paidThisMonthMinor) };
    }),
  ].filter((line) => line.amountMinor > 0);

  for (const line of lines) {
    const wallet = walletById(line.walletId);
    if (!wallet) continue;
    const unpaid = line.unpaid;
    total[wallet.currency] += line.amountMinor;
    left[wallet.currency] += unpaid;
    const need = needs.get(wallet.id) ?? {
      walletId: wallet.id,
      currency: wallet.currency,
      totalMinor: 0,
      unpaidMinor: 0,
      shortMinor: 0,
      position: wallet.position,
      balance: wallet.balanceMinor,
    };
    need.totalMinor += line.amountMinor;
    need.unpaidMinor += unpaid;
    needs.set(wallet.id, need);
  }

  const byWallet = [...needs.values()]
    .sort((a, b) => a.position - b.position)
    .map((n) => ({
      walletId: n.walletId,
      currency: n.currency,
      totalMinor: n.totalMinor,
      unpaidMinor: n.unpaidMinor,
      shortMinor: Math.max(0, n.unpaidMinor - n.balance),
    }));

  const salaryWallet = salary ? walletById(salary.walletId) : undefined;
  let salaryAfter: FixedSummary["salaryAfter"] = null;
  if (salary && salaryWallet) {
    const other: Currency = salaryWallet.currency === "USD" ? "LBP" : "USD";
    salaryAfter = {
      currency: salaryWallet.currency,
      minor: salary.amountMinor - total[salaryWallet.currency],
      excludesOther: total[other] > 0,
    };
  }
  return { byWallet, total, left, salaryAfter };
}
