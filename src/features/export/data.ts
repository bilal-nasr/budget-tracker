import "server-only";

import { categoryEditSchema, type Category } from "@/features/categories/schema";
import type { FixedExpense } from "@/features/fixed/schema";
import { getCycleSnapshot } from "@/features/installments/cycle-queries";
import type { Installment } from "@/features/installments/schema";
import { getLoans } from "@/features/loans/queries";
import type { Loan } from "@/features/loans/schema";
import { getPendingReceipts as getPendingReceiptsForPayment } from "@/features/pending-payments/queries";
import type { PendingPayment } from "@/features/pending-payments/schema";
import { getProfile } from "@/features/profile/queries";
import type { Profile } from "@/features/profile/schema";
import { todayIn } from "@/features/transactions/group";
import { TRANSACTION_COLUMNS, toTransaction, type TransactionRow } from "@/features/transactions/queries";
import { getWallets } from "@/features/wallets/queries";
import { getCurrencies } from "@/features/currencies/queries";
import { validateExportData } from "./model";
import type { WalletContainer } from "@/features/wallets/schema";
import type { CurrencyDefinition } from "@/lib/currency";
import { demoBudgetData, demoFixed, demoInstallments, demoLoans, demoPage } from "@/lib/demo-data";
import { readMinor } from "@/lib/money";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { createClient } from "@/lib/supabase/server";
import type { BudgetRevision, ExportData, ExportLocale, ExportTransaction, PendingReceiptExport } from "./model";

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
  getWallets: () => Promise<WalletContainer[]>;
  getCurrencies: () => Promise<CurrencyDefinition[]>;
  getCategories: () => Promise<Category[]>;
  getTransactions: (exportedAt: Date) => Promise<ExportTransaction[]>;
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

async function getTransactionsForExport(exportedAt: Date): Promise<ExportTransaction[]> {
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
      .lte("created_at", exportedAt.toISOString())
      .order("id", { ascending: true })
      .limit(limit);
    if (afterId !== null) query = query.gt("id", afterId);
    const result = await query;
    return { data: result.data as unknown as ExportTransactionRow[] | null, error: result.error };
  });
  return rows.map((row) => ({ ...toTransaction(row), pendingPaymentId: row.pending_payment_id }));
}

async function getWalletsForExport(): Promise<WalletContainer[]> {
  return getWallets({ includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true });
}

type CategoryRow = {
  id: string; kind: unknown; name_en: string | null; name_ar: string | null; tile: number; color: unknown;
  position: number; parent_id: string | null; archived_at: string | null;
};

async function getCategoriesForExport(): Promise<Category[]> {
  if (!supabaseConfigured()) {
    const { DEMO_CATEGORIES } = await import("@/lib/demo-data");
    return DEMO_CATEGORIES.map((row) => ({ ...row, parentId: row.parentId ?? null, archivedAt: row.archivedAt ?? null }));
  }
  const db = await createClient();
  const rows = await readAllRowsById<CategoryRow>(async (afterId, limit) => {
    let query = db.from("categories").select("id,kind,name_en,name_ar,tile,color,position,parent_id,archived_at")
      .order("id", { ascending: true }).limit(limit);
    if (afterId !== null) query = query.gt("id", afterId);
    const result = await query;
    return { data: result.data as unknown as CategoryRow[] | null, error: result.error };
  });
  return rows.map((row) => {
    if (!(["expense", "income"] as unknown[]).includes(row.kind) || !["teal", "oxblood", "ochre"].includes(String(row.color)) ||
        !categoryEditSchema.shape.tile.safeParse(row.tile).success || !Number.isSafeInteger(row.position)) throw unavailable();
    return {
      id: row.id, kind: row.kind as Category["kind"], nameEn: row.name_en, nameAr: row.name_ar,
      tile: row.tile as Category["tile"], color: row.color as Category["color"], position: row.position,
      parentId: row.parent_id, archivedAt: row.archived_at,
    };
  }).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

type FixedRow = {
  id: string; name: string; amount_minor: number | string; balance_id: string; category_id: string;
  due_day: number | null; items: FixedExpense["items"] | null;
};

async function getFixedExpensesForExport(): Promise<FixedExpense[]> {
  if (!supabaseConfigured()) return demoFixed();
  const db = await createClient();
  const rows = await readAllRowsById<FixedRow>(async (afterId, limit) => {
    let query = db.from("fixed_expenses").select("id,name,amount_minor,balance_id,category_id,due_day,items")
      .order("id", { ascending: true }).limit(limit);
    if (afterId !== null) query = query.gt("id", afterId);
    const result = await query;
    return { data: result.data as unknown as FixedRow[] | null, error: result.error };
  });
  return rows.map((row) => ({
    id: row.id, name: row.name, amountMinor: readMinor(row.amount_minor), balanceId: row.balance_id,
    categoryId: row.category_id, dueDay: row.due_day, paidOn: null, items: row.items ?? [],
  }));
}

type PendingPaymentRow = {
  id: string; client: string; project: string; currency: unknown; total_minor: number | string;
  received_minor: number | string; remaining_minor: number | string; due_on: string | null;
  revision: number; has_receipt_history: boolean;
};

async function getPendingPaymentsForExport(): Promise<PendingPayment[]> {
  if (!supabaseConfigured()) {
    const { getPendingPayments } = await import("@/features/pending-payments/queries");
    return getPendingPayments();
  }
  const db = await createClient();
  const rows = await readAllRowsById<PendingPaymentRow>(async (afterId, limit) => {
    let query = db.from("pending_payment_progress")
      .select("id,client,project,currency,total_minor,received_minor,remaining_minor,due_on,revision,has_receipt_history")
      .is("deleted_at", null).order("id", { ascending: true }).limit(limit);
    if (afterId !== null) query = query.gt("id", afterId);
    const result = await query;
    return { data: result.data as unknown as PendingPaymentRow[] | null, error: result.error };
  });
  return rows.map((row) => {
    if (typeof row.currency !== "string" || !Number.isSafeInteger(row.revision)) throw unavailable();
    return {
      id: row.id, client: row.client, project: row.project, currency: row.currency,
      totalMinor: readMinor(row.total_minor), receivedMinor: readMinor(row.received_minor),
      remainingMinor: readMinor(row.remaining_minor), dueOn: row.due_on, revision: row.revision,
      hasReceiptHistory: row.has_receipt_history,
    };
  });
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
    if (typeof row.currency !== "string" || !/^\d{4}-\d{2}-01$/.test(row.starts_month)) throw unavailable();
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
      balanceId: transaction.balanceId,
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
      balanceId: receipt.balanceId,
      categoryId: null,
    }));
  }));
  return pages.flat();
}

const defaultReaders: ExportSourceReaders = {
  getProfile,
  getWallets: getWalletsForExport,
  getCurrencies,
  getCategories: getCategoriesForExport,
  getTransactions: getTransactionsForExport,
  getBudgetRevisions: getBudgetRevisionsForExport,
  getFixedExpenses: getFixedExpensesForExport,
  getInstallments: async (timezone) => supabaseConfigured() ? (await getCycleSnapshot(timezone)).installments : demoInstallments(timezone),
  getLoans: async () => supabaseConfigured() ? getLoans() : demoLoans(),
  getPendingPayments: getPendingPaymentsForExport,
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
    const [wallets, currencies, categories, transactions, budgetRevisions, fixedExpenses, installments, loans, pendingPayments] = await Promise.all([
      readers.getWallets(),
      readers.getCurrencies(),
      readers.getCategories(),
      readers.getTransactions(exportedAt),
      readers.getBudgetRevisions(cutoffDate),
      readers.getFixedExpenses(profile.timezone),
      readers.getInstallments(profile.timezone),
      readers.getLoans(),
      readers.getPendingPayments(),
    ]);
    const pendingReceipts = await readers.getPendingReceipts(transactions, pendingPayments);
    const data: ExportData = {
      locale,
      timezone: profile.timezone,
      exportedAt: new Date(exportedAt.valueOf()),
      cutoffDate,
      profile,
      wallets,
      currencies,
      categories,
      transactions,
      budgetRevisions,
      fixedExpenses: fixedExpenses.map((fixed) => {
        const paidOn = transactions.filter((transaction) => transaction.source === "fixed" &&
          transaction.fixedExpenseId === fixed.id && transaction.occurredOn.slice(0, 7) === cutoffDate.slice(0, 7))
          .reduce<string | null>((latest, transaction) => latest === null || transaction.occurredOn > latest
            ? transaction.occurredOn : latest, null);
        return { ...fixed, paidOn: paidOn ?? fixed.paidOn };
      }),
      installments,
      loans: loans.filter((loan) => loan.deletedAt === null).map((loan) => ({
        ...loan,
        events: loan.events.filter((event) => event.deletedAt === null),
      })),
      pendingPayments,
      pendingReceipts,
    };
    validateExportData(data);
    return data;
  } catch {
    throw unavailable();
  }
}

function canonicalSnapshot(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    // Catalog and wallet/balance presentation order are part of the snapshot.
    return value.map(canonicalSnapshot);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalSnapshot(entry)]));
  }
  return value;
}

function snapshotToken(data: ExportData): string {
  return JSON.stringify(canonicalSnapshot(data));
}

/**
 * Supabase's HTTP API cannot hold one SQL transaction across several readers.
 * Require two consecutive complete snapshots to match, retrying once; changing
 * data is safer as a failed export than as internally inconsistent accounts.
 */
export async function collectConsistentExportData(
  locale: ExportLocale,
  exportedAt: Date,
  readers: ExportSourceReaders,
): Promise<ExportData> {
  let previous = await collectExportData(locale, exportedAt, readers);
  let previousToken = snapshotToken(previous);
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await collectExportData(locale, exportedAt, readers);
    const currentToken = snapshotToken(current);
    if (currentToken === previousToken) return current;
    previous = current;
    previousToken = currentToken;
  }
  throw unavailable();
}

export async function getExportData(
  locale: ExportLocale,
  exportedAt = new Date(),
): Promise<ExportData> {
  const configured = supabaseConfigured();
  return configured
    ? collectConsistentExportData(locale, exportedAt, defaultReaders)
    : collectExportData(locale, exportedAt, defaultReaders);
}
