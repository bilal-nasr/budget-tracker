import { describe, expect, it } from "vitest";
import { emptyTransactionMetadata, type Transaction } from "@/features/transactions/schema";
import type { BalanceFixture as Wallet } from "@/test/balance-fixtures";
import type { ExportData } from "./model";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
import { singleBalanceWallets } from "./test-fixtures";
import {
  buildBudgetActuals,
  buildMonthlyActivity,
  buildReconciliations,
  buildWalletLedger,
  minorToMajor,
} from "./schedules";

const wallets: Wallet[] = [
  { id: "w-usd", name: "Cash", kind: "cash", currency: "USD", openingBalanceMinor: 10_000, balanceMinor: 9_500, position: 1, archived: false },
  { id: "w-usd-archived", name: "Old cash", kind: "cash", currency: "USD", openingBalanceMinor: 0, balanceMinor: 500, position: 2, archived: true },
  { id: "w-lbp", name: "Lebanese cash", kind: "cash", currency: "LBP", openingBalanceMinor: 100_000, balanceMinor: 230_000, position: 3, archived: false },
  { id: "w-syp", name: "Syrian cash", kind: "cash", currency: "SYP", openingBalanceMinor: 5_000, balanceMinor: 5_600, position: 4, archived: false },
];

function transaction(overrides: Partial<Transaction> & Pick<Transaction, "id" | "kind" | "amountMinor" | "currency" | "balanceId">): Transaction {
  return {
    ...emptyTransactionMetadata(),
    occurredOn: "2026-11-01",
    categoryId: overrides.kind === "transfer" ? null : "c-main",
    toBalanceId: null,
    toAmountMinor: null,
    note: null,
    createdAt: "2026-11-01T10:00:00Z",
    ...overrides,
  };
}

const transactions: Transaction[] = [
  transaction({ id: "t-income", kind: "income", amountMinor: 5_000, currency: "USD", balanceId: "w-usd" }),
  transaction({ id: "t-expense", kind: "expense", amountMinor: 3_000, currency: "USD", balanceId: "w-usd" }),
  transaction({ id: "t-loan-in", kind: "loan", amountMinor: 2_000, currency: "USD", balanceId: "w-usd", loanFlow: "in", loanId: "loan-in" }),
  transaction({ id: "t-loan-out", kind: "loan", amountMinor: 1_000, currency: "USD", balanceId: "w-usd", loanFlow: "out", loanId: "loan-out" }),
  transaction({
    id: "t-transfer", kind: "transfer", amountMinor: 1_500, currency: "USD", balanceId: "w-usd",
    categoryId: null, toBalanceId: "w-lbp", toAmountMinor: 130_000,
  }),
  transaction({
    id: "t-settlement", kind: "expense", amountMinor: 1_000, currency: "USD", balanceId: "w-usd",
    settlement: { tenderMinor: 2_000, tenderCurrency: "USD", changes: [
      { balanceId: "w-usd-archived", amountMinor: 500, currency: "USD" },
      { balanceId: "w-syp", amountMinor: 600, currency: "SYP" },
    ] },
  }),
];

function exportData(): ExportData {
  return {
    locale: "en",
    timezone: "Asia/Beirut",
    exportedAt: new Date("2026-11-05T08:00:00Z"),
    cutoffDate: "2026-11-05",
    profile: { locale: "en", digits: "latin", theme: "light", timezone: "Asia/Beirut", onboarded: true, usdLbpRate: null, salary: null },
    wallets: singleBalanceWallets(wallets),
    currencies: SEED_CURRENCY_DEFINITIONS,
    categories: [{ id: "c-main", kind: "expense", nameEn: "General", nameAr: "عام", tile: 1, color: "teal", position: 1, parentId: null, archivedAt: null }],
    transactions,
    budgetRevisions: [],
    fixedExpenses: [],
    installments: [],
    loans: [],
    pendingPayments: [],
    pendingReceipts: [],
  };
}

describe("wallet ledger", () => {
  it("creates one inflow or outflow leg for ordinary income, expense, and loan cash flows", () => {
    const ledger = buildWalletLedger(exportData());
    expect(ledger.filter((row) => ["t-income", "t-expense", "t-loan-in", "t-loan-out"].includes(row.transactionId)))
      .toMatchObject([
        { transactionId: "t-expense", walletId: "w-usd", inflowMinor: 0, outflowMinor: 3_000 },
        { transactionId: "t-income", walletId: "w-usd", inflowMinor: 5_000, outflowMinor: 0 },
        { transactionId: "t-loan-in", walletId: "w-usd", inflowMinor: 2_000, outflowMinor: 0, loanId: "loan-in" },
        { transactionId: "t-loan-out", walletId: "w-usd", inflowMinor: 0, outflowMinor: 1_000, loanId: "loan-out" },
      ]);
  });

  it("creates both transfer legs and keeps their currencies separate", () => {
    expect(buildWalletLedger(exportData()).filter((row) => row.transactionId === "t-transfer")).toMatchObject([
      { leg: "transfer-out", walletId: "w-usd", currency: "USD", inflowMinor: 0, outflowMinor: 1_500 },
      { leg: "transfer-in", walletId: "w-lbp", currency: "LBP", inflowMinor: 130_000, outflowMinor: 0 },
    ]);
  });

  it("uses tender as payer outflow and adds every cashier-change wallet inflow", () => {
    expect(buildWalletLedger(exportData()).filter((row) => row.transactionId === "t-settlement")).toMatchObject([
      { leg: "expense", walletId: "w-usd", currency: "USD", outflowMinor: 2_000 },
      { leg: "cash-change", walletId: "w-usd-archived", currency: "USD", inflowMinor: 500 },
      { leg: "cash-change", walletId: "w-syp", currency: "SYP", inflowMinor: 600 },
    ]);
  });

  it("reconciles opening balance plus ledger activity to each exported wallet balance", () => {
    expect(buildReconciliations(exportData(), buildWalletLedger(exportData()))).toMatchObject([
      { walletId: "w-usd", calculatedClosingMinor: 9_500, exportedClosingMinor: 9_500, differenceMinor: 0 },
      { walletId: "w-usd-archived", calculatedClosingMinor: 500, exportedClosingMinor: 500, differenceMinor: 0 },
      { walletId: "w-lbp", calculatedClosingMinor: 230_000, exportedClosingMinor: 230_000, differenceMinor: 0 },
      { walletId: "w-syp", calculatedClosingMinor: 5_600, exportedClosingMinor: 5_600, differenceMinor: 0 },
    ]);
  });

  it("retains archived wallets and source identifiers in schedules", () => {
    const archived = buildReconciliations(exportData(), buildWalletLedger(exportData()))
      .find((row) => row.walletId === "w-usd-archived");
    expect(archived).toMatchObject({ walletName: "Old cash", archived: true });
    expect(buildWalletLedger(exportData()).find((row) => row.transactionId === "t-loan-out"))
      .toMatchObject({ transactionId: "t-loan-out", loanId: "loan-out" });
  });
});

describe("accounting schedules", () => {
  it("groups monthly activity by month and currency without a combined currency total", () => {
    expect(buildMonthlyActivity(exportData())).toEqual([
      {
        month: "2026-11", currency: "USD", operatingIncomeMinor: 5_000, operatingExpenseMinor: 4_000,
        loanInMinor: 2_000, loanOutMinor: 1_000, transferInMinor: 0, transferOutMinor: 1_500,
        walletInflowMinor: 7_500, walletOutflowMinor: 7_500, netWalletActivityMinor: 0,
      },
      {
        month: "2026-11", currency: "LBP", operatingIncomeMinor: 0, operatingExpenseMinor: 0,
        loanInMinor: 0, loanOutMinor: 0, transferInMinor: 130_000, transferOutMinor: 0,
        walletInflowMinor: 130_000, walletOutflowMinor: 0, netWalletActivityMinor: 130_000,
      },
      {
        month: "2026-11", currency: "SYP", operatingIncomeMinor: 0, operatingExpenseMinor: 0,
        loanInMinor: 0, loanOutMinor: 0, transferInMinor: 0, transferOutMinor: 0,
        walletInflowMinor: 600, walletOutflowMinor: 0, netWalletActivityMinor: 600,
      },
    ]);
  });

  function budgetData(): ExportData {
    const data = exportData();
    return {
      ...data,
      cutoffDate: "2026-04-30",
      categories: [
        { id: "c-parent", kind: "expense", nameEn: "Food", nameAr: "طعام", tile: 1, color: "teal", position: 1, parentId: null, archivedAt: null },
        { id: "c-child", kind: "expense", nameEn: "Groceries", nameAr: "بقالة", tile: 2, color: "ochre", position: 1, parentId: "c-parent", archivedAt: null },
      ],
      transactions: [
        transaction({ id: "jan", kind: "expense", amountMinor: 4_000, currency: "USD", balanceId: "w-usd", categoryId: "c-child", occurredOn: "2026-01-10" }),
        transaction({ id: "feb", kind: "expense", amountMinor: 6_000, currency: "USD", balanceId: "w-usd", categoryId: "c-child", occurredOn: "2026-02-10" }),
        transaction({ id: "mar", kind: "expense", amountMinor: 7_000, currency: "USD", balanceId: "w-usd", categoryId: "c-child", occurredOn: "2026-03-10" }),
        transaction({ id: "apr", kind: "expense", amountMinor: 21_000, currency: "USD", balanceId: "w-usd", categoryId: "c-child", occurredOn: "2026-04-10" }),
      ],
      budgetRevisions: [
        { id: "b-jan", categoryId: "c-parent", currency: "USD", startsMonth: "2026-01-01", limitMinor: 10_000 },
        { id: "b-mar", categoryId: "c-parent", currency: "USD", startsMonth: "2026-03-01", limitMinor: null },
        { id: "b-apr", categoryId: "c-parent", currency: "USD", startsMonth: "2026-04-01", limitMinor: 20_000 },
      ],
    };
  }

  it("rolls budget revisions forward until the next revision or removal", () => {
    expect(buildBudgetActuals(budgetData())).toMatchObject([
      { month: "2026-01", limitMinor: 10_000, actualMinor: 4_000, varianceMinor: 6_000, variancePercent: 0.6, status: "under" },
      { month: "2026-02", limitMinor: 10_000, actualMinor: 6_000, varianceMinor: 4_000, variancePercent: 0.4, status: "under" },
      { month: "2026-03", limitMinor: null, actualMinor: 7_000, varianceMinor: null, variancePercent: null, status: "unbudgeted" },
      { month: "2026-04", limitMinor: 20_000, actualMinor: 21_000, varianceMinor: -1_000, variancePercent: -0.05, status: "over" },
    ]);
  });

  it("maps subcategory expenses to the parent budget category", () => {
    expect(buildBudgetActuals(budgetData()).every((row) => row.categoryId === "c-parent" && row.categoryName === "Food")).toBe(true);
  });

  it("counts realized outbound loan fees as budget expenses without counting principal", () => {
    const source = budgetData();
    const data: ExportData = {
      ...source,
      cutoffDate: "2026-01-31",
      transactions: [transaction({
        id: "loan-fee", kind: "loan", amountMinor: 10_150, currency: "USD", balanceId: "w-usd",
        categoryId: "c-child", occurredOn: "2026-01-15", loanFlow: "out", loanEvent: "repayment",
        loanPrincipalMinor: 10_000, loanFeeMinor: 150,
      })],
      budgetRevisions: [{ id: "fee-budget", categoryId: "c-parent", currency: "USD", startsMonth: "2026-01-01", limitMinor: 1_000 }],
    };
    expect(buildBudgetActuals(data)).toMatchObject([
      { month: "2026-01", actualMinor: 150, varianceMinor: 850, status: "under" },
    ]);
    expect(buildMonthlyActivity(data)[0]).toMatchObject({ operatingExpenseMinor: 150, loanOutMinor: 10_150 });
  });

  it("reports unavailable variance percent for a missing or zero budget", () => {
    expect(buildBudgetActuals(budgetData()).find((row) => row.month === "2026-03"))
      .toMatchObject({ limitMinor: null, varianceMinor: null, variancePercent: null, status: "unbudgeted" });
    const source = budgetData();
    const zeroBudget: ExportData = { ...source, budgetRevisions: source.budgetRevisions.map((revision) =>
      revision.id === "b-mar" ? { ...revision, limitMinor: 0 } : revision,
    ) };
    expect(buildBudgetActuals(zeroBudget).find((row) => row.month === "2026-03"))
      .toMatchObject({ limitMinor: 0, varianceMinor: -7_000, variancePercent: null, status: "over" });
  });

  it("rejects unsafe minor-unit values instead of rounding them", () => {
    expect(() => minorToMajor(Number.MAX_SAFE_INTEGER, SEED_CURRENCY_DEFINITIONS[0])).toThrow(RangeError);
  });
});
