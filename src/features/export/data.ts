import "server-only";

import { getCategories } from "@/features/categories/queries";
import type { Category } from "@/features/categories/schema";
import { getFixedExpenses } from "@/features/fixed/queries";
import type { FixedExpense } from "@/features/fixed/schema";
import { getCycleSnapshot } from "@/features/installments/cycle-queries";
import type { Installment } from "@/features/installments/schema";
import { getLoans } from "@/features/loans/queries";
import type { Loan } from "@/features/loans/schema";
import { getPendingPayments, getPendingReceipts as getPendingReceiptsForPayment } from "@/features/pending-payments/queries";
import type { PendingPayment } from "@/features/pending-payments/schema";
import { getProfile } from "@/features/profile/queries";
import type { Profile } from "@/features/profile/schema";
import { todayIn } from "@/features/transactions/group";
import { TRANSACTION_COLUMNS, toTransaction, type TransactionRow } from "@/features/transactions/queries";
import { getWallets } from "@/features/wallets/queries";
import type { Wallet } from "@/features/wallets/schema";
import { demoBudgetData, demoFixed, demoInstallments, demoLoans, demoPage } from "@/lib/demo-data";
import { isCurrency, readMinor } from "@/lib/money";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { createClient } from "@/lib/supabase/server";
import type { BudgetRevision, ExportData, ExportLocale, ExportTransaction, PendingReceiptExport } from "./model";
import { buildReconciliations, buildWalletLedger } from "./schedules";

const EXPORT_PAGE_SIZE = 500;

function unavailable(): Error {
  return new Error("export_data_unavailable");
}

export async function readAllRowsById<T extends { id: string }>(
  load: (afterId: string | null, limit: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = EXPORT_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 999) throw unavailable();
  const rows: T[] = [];
  const seen = new Set<string>();
  let afterId: string | null = null;
  for (;;) {
    const page = await load(afterId, pageSize);
    if (page.error || !Array.isArray(page.data) || page.data.length > pageSize) throw unavailable();
    let previous = afterId;
    for (const row of page.data) {
      if (!row || typeof row.id !== "string" || row.id.length === 0 || seen.has(row.id) ||
          (previous !== null && row.id <= previous)) throw unavailable();
      seen.add(row.id);
      rows.push(row);
      previous = row.id;
    }
    if (page.data.length < pageSize) return rows;
    afterId = page.data.at(-1)?.id ?? null;
    if (afterId === null) throw unavailable();
  }
}

export type ExportSourceReaders = {
  getProfile: () => Promise<Profile>;
  getWallets: () => Promise<Wallet[]>;
  getCategories: () => Promise<Category[]>;
  getTransactions: () => Promise<ExportTransaction[]>;
  getBudgetRevisions: (cutoffDate: string) => Promise<BudgetRevision[]>;
  getFixedExpenses: (timezone: string) => Promise<FixedExpense[]>;
  getInstallments: (timezone: string) => Promise<Installment[]>;
  getLoans: () => Promise<Loan[]>;
  getPendingPayments: () => Promise<PendingPayment[]>;
  getPendingReceipts: (
    transactions: readonly ExportTransaction[],
    pendingPayments: readonly PendingPayment[],
  ) => Promise<PendingReceiptExport[]>;
};

type ExportTransactionRow = TransactionRow & { pending_payment_id: string | null };

async function getTransactionsForExport(): Promise<ExportTransaction[]> {
  if (!supabaseConfigured()) {
    const rows: ExportTransaction[] = [];
    let cursor: Parameters<typeof demoPage>[1] = null;
    do {
      const page = demoPage({}, cursor, EXPORT_PAGE_SIZE);
      rows.push(...page.rows.map((transaction) => ({ ...transaction, pendingPaymentId: null })));
      cursor = page.next;
    } while (cursor !== null);
    return rows;
  }
  const db = await createClient();
  const rows = await readAllRowsById<ExportTransactionRow>(async (afterId, limit) => {
    let query = db.from("transactions")
      .select(`${TRANSACTION_COLUMNS}, pending_payment_id`)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .limit(limit);
    if (afterId !== null) query = query.gt("id", afterId);
    const result = await query;
    return { data: result.data as unknown as ExportTransactionRow[] | null, error: result.error };
  });
  return rows.map((row) => ({ ...toTransaction(row), pendingPaymentId: row.pending_payment_id }));
}

type BudgetRow = {
  id: string;
  category_id: string;
  currency: unknown;
  starts_month: string;
  limit_minor: number | string | null;
};

async function getBudgetRevisionsForExport(cutoffDate: string): Promise<BudgetRevision[]> {
  if (!supabaseConfigured()) {
    const month = cutoffDate.slice(0, 7);
    return demoBudgetData(month).budgets.map((budget, index) => ({
      id: `demo-budget-${index}`,
      categoryId: budget.categoryId,
      currency: budget.currency,
      startsMonth: `${month}-01`,
      limitMinor: budget.limitMinor,
    }));
  }
  const db = await createClient();
  const rows = await readAllRowsById<BudgetRow>(async (afterId, limit) => {
    let query = db.from("budgets")
      .select("id,category_id,currency,starts_month,limit_minor")
      .lte("starts_month", cutoffDate)
      .order("id", { ascending: true })
      .limit(limit);
    if (afterId !== null) query = query.gt("id", afterId);
    const result = await query;
    return { data: result.data as unknown as BudgetRow[] | null, error: result.error };
  });
  return rows.map((row) => {
    if (!isCurrency(row.currency) || !/^\d{4}-\d{2}-01$/.test(row.starts_month)) throw unavailable();
    return {
      id: row.id,
      categoryId: row.category_id,
      currency: row.currency,
      startsMonth: row.starts_month,
      limitMinor: row.limit_minor === null ? null : readMinor(row.limit_minor),
    };
  });
}

async function getPendingReceiptsForExport(
  transactions: readonly ExportTransaction[],
  pendingPayments: readonly PendingPayment[],
): Promise<PendingReceiptExport[]> {
  if (supabaseConfigured()) {
    return transactions.filter((transaction) => transaction.pendingPaymentId).map((transaction) => ({
      id: transaction.id,
      paymentId: transaction.pendingPaymentId!,
      amountMinor: transaction.amountMinor,
      occurredOn: transaction.occurredOn,
      walletId: transaction.walletId,
      categoryId: transaction.categoryId,
    }));
  }
  const pages = await Promise.all(pendingPayments.map(async (payment) => {
    const receipts = await getPendingReceiptsForPayment(payment.id);
    return receipts.map((receipt): PendingReceiptExport => ({
      id: receipt.id,
      paymentId: payment.id,
      amountMinor: receipt.amountMinor,
      occurredOn: receipt.occurredOn,
      walletId: receipt.walletId,
      categoryId: null,
    }));
  }));
  return pages.flat();
}

const defaultReaders: ExportSourceReaders = {
  getProfile,
  getWallets,
  getCategories,
  getTransactions: getTransactionsForExport,
  getBudgetRevisions: getBudgetRevisionsForExport,
  getFixedExpenses: async (timezone) => supabaseConfigured() ? getFixedExpenses(timezone) : demoFixed(),
  getInstallments: async (timezone) => supabaseConfigured() ? (await getCycleSnapshot(timezone)).installments : demoInstallments(timezone),
  getLoans: async () => supabaseConfigured() ? getLoans() : demoLoans(),
  getPendingPayments,
  getPendingReceipts: getPendingReceiptsForExport,
};

export async function collectExportData(
  locale: ExportLocale,
  exportedAt: Date,
  readers: ExportSourceReaders,
): Promise<ExportData> {
  try {
    if (!(exportedAt instanceof Date) || !Number.isFinite(exportedAt.valueOf())) throw unavailable();
    const profile = await readers.getProfile();
    const cutoffDate = todayIn(profile.timezone, exportedAt);
    const [wallets, categories, transactions, budgetRevisions, fixedExpenses, installments, loans, pendingPayments] = await Promise.all([
      readers.getWallets(),
      readers.getCategories(),
      readers.getTransactions(),
      readers.getBudgetRevisions(cutoffDate),
      readers.getFixedExpenses(profile.timezone),
      readers.getInstallments(profile.timezone),
      readers.getLoans(),
      readers.getPendingPayments(),
    ]);
    const pendingReceipts = await readers.getPendingReceipts(transactions, pendingPayments);
    return {
      locale,
      timezone: profile.timezone,
      exportedAt: new Date(exportedAt.valueOf()),
      cutoffDate,
      profile,
      wallets,
      categories,
      transactions,
      budgetRevisions,
      fixedExpenses,
      installments,
      loans: loans.filter((loan) => loan.deletedAt === null).map((loan) => ({
        ...loan,
        events: loan.events.filter((event) => event.deletedAt === null),
      })),
      pendingPayments,
      pendingReceipts,
    };
  } catch {
    throw unavailable();
  }
}

export async function getExportData(
  locale: ExportLocale,
  exportedAt = new Date(),
): Promise<ExportData> {
  const data = await collectExportData(locale, exportedAt, defaultReaders);
  if (supabaseConfigured()) return data;
  // Demo wallet figures are illustrative UI snapshots. The export uses the
  // complete synthetic ledger, so derive its closing balances from the same
  // rows to keep the accountant reconciliation meaningful.
  const closingByWallet = new Map(
    buildReconciliations(data, buildWalletLedger(data)).map((row) => [row.walletId, row.calculatedClosingMinor]),
  );
  return {
    ...data,
    wallets: data.wallets.map((wallet) => ({
      ...wallet,
      balanceMinor: closingByWallet.get(wallet.id) ?? wallet.openingBalanceMinor,
    })),
  };
}
