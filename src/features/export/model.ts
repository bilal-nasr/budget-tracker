import type { Category } from "@/features/categories/schema";
import type { FixedExpense } from "@/features/fixed/schema";
import type { Installment } from "@/features/installments/schema";
import type { Loan } from "@/features/loans/schema";
import type { PendingPayment } from "@/features/pending-payments/schema";
import type { Profile } from "@/features/profile/schema";
import type { Transaction } from "@/features/transactions/schema";
import type { Wallet } from "@/features/wallets/schema";
import type { Currency } from "@/lib/money";

export type ExportLocale = "en" | "ar";

export type BudgetRevision = {
  id: string;
  categoryId: string;
  currency: Currency;
  startsMonth: string;
  /** Null removes the limit from this month forward. */
  limitMinor: number | null;
};

export type PendingReceiptExport = {
  id: string;
  paymentId: string;
  amountMinor: number;
  occurredOn: string;
  walletId: string;
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
  wallets: readonly Wallet[];
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
  walletId: string;
  walletName: string;
  currency: Currency;
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
  walletId: string;
  walletName: string;
  currency: Currency;
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
  currency: Currency;
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
  currency: Currency;
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

