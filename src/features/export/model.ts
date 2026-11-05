import type { Category } from "@/features/categories/schema";
import type { FixedExpense } from "@/features/fixed/schema";
import type { Installment } from "@/features/installments/schema";
import type { Loan } from "@/features/loans/schema";
import type { PendingPayment } from "@/features/pending-payments/schema";
import type { Profile } from "@/features/profile/schema";
import type { Transaction } from "@/features/transactions/schema";
import { walletContainerSchema, type WalletBalance, type WalletContainer, type WalletKind } from "@/features/wallets/schema";
import { currencyInputSchema } from "@/features/currencies/schema";
import { indexCurrencies, requireCurrency, type CurrencyDefinition } from "@/lib/currency";
import { readMinor } from "@/lib/money";

/** A retained balance, with its exact container identity and historical visibility. */
export type ExportBalance = WalletBalance & {
  name: string;
  kind: WalletKind;
  defaultBalanceId: string | null;
  walletPosition: number;
  archived: boolean;
  deleted: boolean;
  needsAttention: boolean;
};

export function historicalExportBalances(wallets: readonly WalletContainer[], currencies: readonly CurrencyDefinition[]): ExportBalance[] {
  try {
    indexCurrencies(currencies);
    for (const currency of currencies) {
      const parsed = currencyInputSchema.parse({ code: currency.code, symbol: currency.symbol, decimalPlaces: currency.decimalPlaces });
      if (parsed.code !== currency.code || parsed.symbol !== currency.symbol || typeof currency.disabled !== "boolean" || typeof currency.firstUsed !== "boolean") throw new Error();
    }
    const walletIds = new Set<string>();
    const balanceIds = new Set<string>();
    return wallets.flatMap((input) => {
      const wallet = walletContainerSchema.parse(input);
      if (walletIds.has(wallet.id)) throw new Error();
      walletIds.add(wallet.id);
      return wallet.balances.map((balance) => {
        requireCurrency(balance.currency, currencies);
        if (balanceIds.has(balance.id)) throw new Error();
        balanceIds.add(balance.id);
        return { ...balance, name: wallet.name, kind: wallet.kind, defaultBalanceId: wallet.defaultBalanceId,
          walletPosition: wallet.position, archived: wallet.deleted || wallet.needsAttention || balance.detached,
          deleted: wallet.deleted, needsAttention: wallet.needsAttention };
      });
    });
  } catch {
    throw new Error("export_data_unavailable");
  }
}

export type ExportLocale = "en" | "ar";

export type BudgetRevision = {
  id: string;
  categoryId: string;
  currency: string;
  startsMonth: string;
  /** Null removes the limit from this month forward. */
  limitMinor: number | null;
};

export type PendingReceiptExport = {
  id: string;
  paymentId: string;
  amountMinor: number;
  occurredOn: string;
  balanceId: string;
  categoryId: string | null;
};

export type ExportTransaction = Transaction & { pendingPaymentId?: string | null };

export type ExportData = {
  locale: ExportLocale;
  timezone: string;
  exportedAt: Date;
  /** Inclusive accounting cutoff in YYYY-MM-DD form. */
  cutoffDate: string;
  profile: Profile;
  currencies: readonly CurrencyDefinition[];
  wallets: readonly WalletContainer[];
  categories: readonly Category[];
  transactions: readonly ExportTransaction[];
  budgetRevisions: readonly BudgetRevision[];
  fixedExpenses: readonly FixedExpense[];
  installments: readonly Installment[];
  loans: readonly Loan[];
  pendingPayments: readonly PendingPayment[];
  pendingReceipts: readonly PendingReceiptExport[];
};

export type WalletLedgerLeg = "income" | "expense" | "loan-in" | "loan-out" | "transfer-in" | "transfer-out" | "cash-change";

export type WalletLedgerRow = {
  rowId: string;
  transactionId: string;
  occurredOn: string;
  createdAt: string;
  balanceId: string;
  walletId: string;
  walletName: string;
  currency: string;
  leg: WalletLedgerLeg;
  inflowMinor: number;
  outflowMinor: number;
  categoryId: string | null;
  categoryName: string;
  note: string | null;
  source: Transaction["source"];
  fixedExpenseId: string | null;
  installmentId: string | null;
  loanId: string | null;
  pendingPaymentId: string | null;
};

export type WalletReconciliation = {
  balanceId: string;
  walletId: string;
  walletName: string;
  currency: string;
  archived: boolean;
  openingBalanceMinor: number;
  inflowMinor: number;
  outflowMinor: number;
  calculatedClosingMinor: number;
  exportedClosingMinor: number;
  differenceMinor: number;
};

export type MonthlyActivityRow = {
  month: string;
  currency: string;
  operatingIncomeMinor: number;
  operatingExpenseMinor: number;
  loanInMinor: number;
  loanOutMinor: number;
  transferInMinor: number;
  transferOutMinor: number;
  walletInflowMinor: number;
  walletOutflowMinor: number;
  netWalletActivityMinor: number;
};

export type BudgetActualRow = {
  month: string;
  categoryId: string;
  categoryName: string;
  currency: string;
  limitMinor: number | null;
  actualMinor: number;
  varianceMinor: number | null;
  variancePercent: number | null;
  status: "under" | "over" | "on" | "unbudgeted";
};

export type ExportSchedules = {
  walletLedger: WalletLedgerRow[];
  reconciliations: WalletReconciliation[];
  monthlyActivity: MonthlyActivityRow[];
  budgetActuals: BudgetActualRow[];
};


/** Validate every denomination and exact historical reference before producing any workbook. */
export function validateExportData(data: ExportData): void {
  try {
    const balances = new Map(historicalExportBalances(data.wallets, data.currencies).map((balance) => [balance.id, balance]));
    const definition = (currency: string) => requireCurrency(currency, data.currencies);
    const balance = (id: string, currency?: string) => {
      const found = balances.get(id);
      if (!found || (currency !== undefined && found.currency !== currency)) throw new Error();
      return found;
    };
    for (const row of data.transactions) {
      definition(row.currency);
      balance(row.balanceId, row.settlement?.tenderCurrency ?? row.currency);
      readMinor(row.amountMinor);
      if (row.toBalanceId !== null) balance(row.toBalanceId);
      if (row.kind === "transfer" && (row.toBalanceId === null || row.toAmountMinor === null)) throw new Error();
      if (row.settlement) {
        definition(row.settlement.tenderCurrency ?? row.currency);
        for (const change of row.settlement.changes) balance(change.balanceId, change.currency);
      }
    }
    for (const row of data.budgetRevisions) definition(row.currency);
    for (const row of data.fixedExpenses) balance(row.balanceId);
    if (data.profile.salary) balance(data.profile.salary.balanceId);
    for (const row of data.installments) {
      definition(row.currency); balance(row.balanceId, row.currency);
      for (const payment of row.payments) balance(payment.balanceId, row.currency);
    }
    for (const row of data.loans) {
      definition(row.currency); balance(row.balanceId, row.currency);
      for (const event of row.events) balance(event.balanceId, row.currency);
    }
    const payments = new Map(data.pendingPayments.map((row) => [row.id, row]));
    for (const row of data.pendingPayments) definition(row.currency);
    for (const row of data.pendingReceipts) {
      const payment = payments.get(row.paymentId);
      if (!payment) throw new Error();
      balance(row.balanceId, payment.currency);
    }
  } catch {
    throw new Error("export_data_unavailable");
  }
}
