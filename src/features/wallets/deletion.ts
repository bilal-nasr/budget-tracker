import type { CurrencyDefinition } from "@/lib/currency";
import { readMinor } from "@/lib/money";
import type { WalletContainer } from "./schema";

export type WalletDeletionDependency = {
  kind: "salary" | "fixedExpense" | "installment" | "loan";
  balanceId: string;
  id?: string;
  name?: string;
};
export type WalletDeletionBlocker = WalletDeletionDependency | {
  kind: "noCounterpart" | "unavailableCurrency";
  balanceId: string;
  currency: string;
};
export type WalletSettlement = { balanceId: string; counterpartBalanceId: string | null; expectedAmountMinor: number; expectedUnit: { code: string; decimalPlaces: number } };
export type WalletDeletionPlan = {
  walletId: string;
  walletName: string;
  needsAttention: boolean;
  lines: {
    balanceId: string;
    currency: CurrencyDefinition;
    amountMinor: number;
    direction: "out" | "in";
    counterparts: { walletId: string; walletName: string; balanceId: string }[];
  }[];
  snapshot: Omit<WalletSettlement, "counterpartBalanceId">[];
  blockers: WalletDeletionBlocker[];
};

/** Read-only projection. Missing universal rows are errors, never zero balances. */
export function buildWalletDeletionPlan(walletId: string, wallets: readonly WalletContainer[], currencies: readonly CurrencyDefinition[], dependencies: readonly WalletDeletionDependency[]): WalletDeletionPlan {
  const source = wallets.find((wallet) => wallet.id === walletId && !wallet.deleted);
  if (!source) throw new Error("Wallet inspection unavailable");
  const eligible = wallets.filter((wallet) => !wallet.deleted && !wallet.needsAttention && wallet.id !== source.id).sort((a, b) => a.position - b.position);
  for (const wallet of [source, ...eligible]) {
    if (currencies.some((currency) => !currency.disabled && wallet.balances.filter((balance) => balance.currency === currency.code && !balance.detached && balance.walletId === wallet.id).length !== 1)) throw new Error("Wallet inspection unavailable");
  }
  const blockers: WalletDeletionBlocker[] = [...dependencies];
  const lines: WalletDeletionPlan["lines"] = [];
  for (const currency of currencies) {
    const balance = source.balances.find((balance) => balance.currency === currency.code);
    if (!balance || readMinor(balance.balanceMinor) === 0) continue;
    if (currency.disabled || balance.detached) {
      blockers.push({ kind: "unavailableCurrency", balanceId: balance.id, currency: currency.code });
      continue;
    }
    const counterparts = eligible.map((wallet) => ({ walletId: wallet.id, walletName: wallet.name, balanceId: wallet.balances.find((balance) => balance.currency === currency.code)!.id }));
    lines.push({ balanceId: balance.id, currency, amountMinor: Math.abs(balance.balanceMinor), direction: balance.balanceMinor > 0 ? "out" : "in", counterparts });
    if (counterparts.length === 0) blockers.push({ kind: "noCounterpart", balanceId: balance.id, currency: currency.code });
  }
  if (source.balances.some((balance) => !currencies.some((currency) => currency.code === balance.currency))) throw new Error("Wallet inspection unavailable");
  const snapshot = source.balances.map((balance) => {
    const definition = currencies.find((currency) => currency.code === balance.currency)!;
    return { balanceId: balance.id, expectedAmountMinor: readMinor(balance.balanceMinor), expectedUnit: { code: definition.code, decimalPlaces: definition.decimalPlaces } };
  });
  return { walletId: source.id, walletName: source.name, needsAttention: source.needsAttention, lines, snapshot, blockers };
}

/** Resolve selected wallet identities against existing same-currency rows only. */
export function resolveWalletSettlements(plan: WalletDeletionPlan, choices: Readonly<Record<string, string>>): WalletSettlement[] | null {
  if (plan.blockers.length || Object.keys(choices).some((key) => !plan.lines.some((line) => line.balanceId === key))) return null;
  const settlements: WalletSettlement[] = [];
  for (const snapshot of plan.snapshot) {
    const line = plan.lines.find((line) => line.balanceId === snapshot.balanceId);
    const counterpart = line?.counterparts.find((wallet) => wallet.walletId === choices[snapshot.balanceId]);
    if (snapshot.expectedAmountMinor !== 0 && !counterpart) return null;
    settlements.push({ ...snapshot, counterpartBalanceId: counterpart?.balanceId ?? null });
  }
  return settlements;
}
