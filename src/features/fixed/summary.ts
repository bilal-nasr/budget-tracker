import { dueThisCycle, type Installment } from "@/features/installments/cycle";
import { sumMinor } from "@/lib/money";
import type { FixedExpense } from "./schema";

export type BalanceNeed = {
  balanceId: string;
  currency: string;
  /** Monthly fixed items plus current receipt-cycle installment targets. */
  totalMinor: number;
  /** The part not paid yet. */
  unpaidMinor: number;
  /** How much the balance lacks to cover the unpaid part; 0 when it has enough. */
  shortMinor: number;
};

export type FixedSummary = {
  /** In balance display order. */
  byBalance: BalanceNeed[];
  total: Record<string, number>;
  /** Unpaid, per currency. */
  left: Record<string, number>;
  /** Salary minus the fixed total in the salary's own currency. Negative when short. */
  salaryAfter: { currency: string; minor: number; excludedCurrencies: string[] } | null;
};

/** Per-balance needs, totals and salary left after fixed expenses. Currencies are never combined. */
export function summarizeFixed(
  items: readonly FixedExpense[],
  balanceById: (id: string) => { id: string; currency: string; balanceMinor: number; position: number } | undefined,
  salary: { amountMinor: number; balanceId: string } | null,
  installments: readonly Installment[],
  currencyOrder: readonly string[],
): FixedSummary {
  const total = {} as Record<string, number>;
  const left = {} as Record<string, number>;
  const needs = new Map<string, BalanceNeed & { position: number; balance: number }>();

  // Installment targets use actual salary cycles; fixed items keep their month.
  const lines = [
    ...items.map((item) => ({
      balanceId: item.balanceId,
      amountMinor: item.amountMinor,
      unpaid: item.paidOn === null ? item.amountMinor : 0,
    })),
    ...installments.map((i) => {
      const due = dueThisCycle(i);
      return { balanceId: i.balanceId, amountMinor: due, unpaid: Math.max(0, due - i.paidThisCycleMinor) };
    }),
  ].filter((line) => line.amountMinor > 0);

  for (const line of lines) {
    const balance = balanceById(line.balanceId);
    if (!balance) continue;
    const unpaid = line.unpaid;
    total[balance.currency] = sumMinor([total[balance.currency] ?? 0, line.amountMinor]);
    left[balance.currency] = sumMinor([left[balance.currency] ?? 0, unpaid]);
    const need = needs.get(balance.id) ?? {
      balanceId: balance.id,
      currency: balance.currency,
      totalMinor: 0,
      unpaidMinor: 0,
      shortMinor: 0,
      position: balance.position,
      balance: balance.balanceMinor,
    };
    need.totalMinor = sumMinor([need.totalMinor, line.amountMinor]);
    need.unpaidMinor = sumMinor([need.unpaidMinor, unpaid]);
    needs.set(balance.id, need);
  }

  const byWallet = [...needs.values()]
    .sort((a, b) => a.position - b.position)
    .map((n) => ({
      balanceId: n.balanceId,
      currency: n.currency,
      totalMinor: n.totalMinor,
      unpaidMinor: n.unpaidMinor,
      shortMinor: Math.max(0, sumMinor([n.unpaidMinor, -n.balance])),
    }));

  const salaryWallet = salary ? balanceById(salary.balanceId) : undefined;
  let salaryAfter: FixedSummary["salaryAfter"] = null;
  if (salary && salaryWallet) {
    salaryAfter = {
      currency: salaryWallet.currency,
      minor: sumMinor([salary.amountMinor, -(total[salaryWallet.currency] ?? 0)]),
      excludedCurrencies: currencyOrder.filter((currency) => currency !== salaryWallet.currency && total[currency] > 0),
    };
  }
  return { byBalance: byWallet, total, left, salaryAfter };
}
