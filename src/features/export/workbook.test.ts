import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { emptyTransactionMetadata } from "@/features/transactions/schema";
import type { ExportData } from "./model";
vi.mock("server-only", () => ({}));
import { getExportLabels } from "./labels";
import { buildExportWorkbook, writeExportWorkbook } from "./workbook";

const ENGLISH_SHEETS = [
  "Cover", "Financial Summary", "Reconciliation", "Monthly Activity", "Wallet Ledger", "Budget vs Actual",
  "Transactions", "Expense Items", "Wallets", "Categories", "Salary", "Fixed Expenses", "Installments",
  "Installment Payments", "Loans", "Loan Payments", "Receivables", "Receipts", "Checks & Definitions",
];

const ARABIC_SHEETS = [
  "الغلاف", "الملخص المالي", "التسوية", "النشاط الشهري", "دفتر المحافظ", "الميزانية والفعلية",
  "المعاملات", "تفاصيل المصروفات", "المحافظ", "الفئات", "الراتب", "المصاريف الثابتة", "الأقساط",
  "دفعات الأقساط", "القروض", "دفعات القروض", "المبالغ المستحقة", "التحصيلات", "الفحوص والتعريفات",
];

function fixture(locale: "en" | "ar" = "en"): ExportData {
  return {
    locale,
    timezone: "Asia/Beirut",
    exportedAt: new Date("2026-11-05T08:00:00Z"),
    cutoffDate: "2026-11-05",
    profile: { locale, digits: "latin", theme: "light", timezone: "Asia/Beirut", onboarded: true, usdLbpRate: null,
      salary: { amountMinor: 200_000, walletId: "wallet" } },
    wallets: [{ id: "wallet", name: "Main wallet", kind: "bank", currency: "USD", openingBalanceMinor: 10_000,
      balanceMinor: 11_000, position: 1, archived: false }],
    categories: [{ id: "category", kind: "income", nameEn: "Consulting", nameAr: "استشارات", tile: 1,
      color: "teal", position: 1, parentId: null, archivedAt: null }],
    transactions: [{
      ...emptyTransactionMetadata(), id: "transaction", kind: "income", occurredOn: "2026-11-01", amountMinor: 1_000,
      currency: "USD", walletId: "wallet", categoryId: "category", toWalletId: null, toAmountMinor: null,
      note: "November work", createdAt: "2026-11-01T10:00:00Z", pendingPaymentId: "pending",
    }],
    budgetRevisions: [],
    fixedExpenses: [],
    installments: [],
    loans: [],
    pendingPayments: [{ id: "pending", client: "Client", project: "Project", currency: "USD", totalMinor: 2_000,
      receivedMinor: 1_000, remainingMinor: 1_000, dueOn: "2026-11-30", revision: 1, hasReceiptHistory: true }],
    pendingReceipts: [{ id: "transaction", paymentId: "pending", amountMinor: 1_000, occurredOn: "2026-11-01",
      walletId: "wallet", categoryId: "category" }],
  };
}

function emptyFixture(locale: "en" | "ar" = "en"): ExportData {
  const data = fixture(locale);
  return {
    ...data,
    profile: { ...data.profile, salary: null },
    wallets: [], categories: [], transactions: [], budgetRevisions: [], fixedExpenses: [], installments: [], loans: [],
    pendingPayments: [], pendingReceipts: [],
  };
}

describe("accountant workbook structure", () => {
  it("creates every accountant workpaper in English with stable Excel table names", () => {
    const workbook = buildExportWorkbook(fixture("en"));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(ENGLISH_SHEETS);
    expect(workbook.getWorksheet("Wallet Ledger")?.getTable("WalletLedgerTable").name).toBe("WalletLedgerTable");
    expect(workbook.getWorksheet("Transactions")?.getTable("TransactionsTable").name).toBe("TransactionsTable");
    expect(workbook.getWorksheet("Receivables")?.getTable("ReceivablesTable").name).toBe("ReceivablesTable");
  });

  it("creates every workpaper in Arabic with translated labels and RTL views", () => {
    const workbook = buildExportWorkbook(fixture("ar"));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(ARABIC_SHEETS);
    expect(workbook.worksheets.every((sheet) => sheet.views[0]?.rightToLeft === true)).toBe(true);
    expect(workbook.getWorksheet("دفتر المحافظ")?.getRow(4).values).toContain(getExportLabels("ar").columns.walletName);
  });

  it("keeps all nineteen sheets with headers when every source schedule is empty", () => {
    const workbook = buildExportWorkbook(emptyFixture());
    expect(workbook.worksheets).toHaveLength(19);
    for (const sheet of workbook.worksheets.slice(2)) {
      expect(sheet.getRow(4).cellCount).toBeGreaterThan(0);
    }
  });

  it("stores dates and amounts as typed Excel values using currency precision", () => {
    const workbook = buildExportWorkbook(fixture());
    const sheet = workbook.getWorksheet("Transactions")!;
    const headers = sheet.getRow(4).values as unknown[];
    const dateColumn = headers.indexOf("Date");
    const amountColumn = headers.indexOf("Amount");
    expect(sheet.getCell(5, dateColumn).value).toBeInstanceOf(Date);
    expect(sheet.getCell(5, amountColumn).value).toBe(10);
  });

  it("stores a cross-currency transfer destination currency and formats its amount independently", () => {
    const source = fixture();
    const data: ExportData = { ...source, wallets: [
      { ...source.wallets[0], currency: "LBP", openingBalanceMinor: 0, balanceMinor: -100_000 },
      { id: "usd-wallet", name: "USD wallet", kind: "bank", currency: "USD", openingBalanceMinor: 0,
        balanceMinor: 1_234, position: 2, archived: false },
    ], transactions: [{
      ...source.transactions[0], kind: "transfer", categoryId: null, currency: "LBP", amountMinor: 100_000,
      toWalletId: "usd-wallet", toAmountMinor: 1_234,
    }] };
    const labels = getExportLabels("en");
    const sheet = buildExportWorkbook(data).getWorksheet("Transactions")!;
    const destinationWalletId = columnAt(sheet, `${labels.columns.transferIn} ${labels.columns.walletId}`);
    const destinationCurrency = columnAt(sheet, `${labels.columns.transferIn} ${labels.columns.currency}`);
    const destinationAmount = columnAt(sheet, `${labels.columns.transferIn} ${labels.columns.amount}`);
    expect(sheet.getCell(5, destinationWalletId).value).toBe("usd-wallet");
    expect(sheet.getCell(5, destinationCurrency).value).toBe("USD");
    expect(sheet.getCell(5, destinationAmount).value).toBe(12.34);
    expect(sheet.getCell(5, destinationAmount).numFmt).toBe("#,##0.00;(#,##0.00);-");
  });

  it("localizes authored enum values in Arabic workpapers", () => {
    const source = fixture("ar");
    const data: ExportData = { ...source, transactions: source.transactions.map((row) => ({ ...row, source: "salary" })) };
    const workbook = buildExportWorkbook(data);
    const transactions = workbook.getWorksheet("المعاملات")!;
    const wallets = workbook.getWorksheet("المحافظ")!;
    const ledger = workbook.getWorksheet("دفتر المحافظ")!;
    expect(transactions.getCell(5, columnAt(transactions, "النوع")).value).toBe("دخل");
    expect(transactions.getCell(5, columnAt(transactions, "المصدر")).value).toBe("راتب");
    expect(wallets.getCell(5, columnAt(wallets, "نوع المحفظة")).value).toBe("مصرفية");
    expect(ledger.getCell(5, columnAt(ledger, "قيد المحفظة")).value).toBe("دخل");
  });
});

it("uses a real ExcelJS workbook", () => {
  expect(buildExportWorkbook(fixture())).toBeInstanceOf(ExcelJS.Workbook);
});

function columnAt(sheet: ExcelJS.Worksheet, label: string): number {
  const values = sheet.getRow(4).values as unknown[];
  const column = values.indexOf(label);
  if (column < 1) throw new Error(`Missing test column: ${label}`);
  return column;
}

function formulaAt(sheet: ExcelJS.Worksheet, row: number, column: number): { formula: string; result?: ExcelJS.CellValue } {
  const value = sheet.getCell(row, column).value;
  if (!value || typeof value !== "object" || !("formula" in value)) throw new Error(`Missing formula at ${row},${column}`);
  return value as { formula: string; result?: ExcelJS.CellValue };
}

describe("accountant workbook controls", () => {
  it("links reconciliation inflows and outflows to the wallet ledger and shows a zero difference result", () => {
    const workbook = buildExportWorkbook(fixture());
    const sheet = workbook.getWorksheet("Reconciliation")!;
    const inflow = formulaAt(sheet, 5, columnAt(sheet, "Inflow"));
    const outflow = formulaAt(sheet, 5, columnAt(sheet, "Outflow"));
    const difference = formulaAt(sheet, 5, columnAt(sheet, "Difference"));
    expect(inflow.formula).toContain("SUMIFS(WalletLedgerTable[Inflow]");
    expect(outflow.formula).toContain("SUMIFS(WalletLedgerTable[Outflow]");
    expect(Number(difference.result)).toBe(0);
  });

  it("links summary totals by currency without a combined currency formula", () => {
    const workbook = buildExportWorkbook(fixture());
    const sheet = workbook.getWorksheet("Financial Summary")!;
    expect([sheet.getCell("A5").value, sheet.getCell("A6").value, sheet.getCell("A7").value]).toEqual(["USD", "LBP", "SYP"]);
    for (let row = 5; row <= 7; row++) {
      expect(formulaAt(sheet, row, 2).formula).toContain("ReconciliationTable");
      expect(formulaAt(sheet, row, 2).formula).toContain(`$A${row}`);
      expect(formulaAt(sheet, row, 11).formula).toContain("MonthlyActivityTable");
    }
    const labels = getExportLabels("en");
    expect(sheet.getRow(4).values).toEqual(expect.arrayContaining([
      labels.columns.budget,
      labels.columns.actual,
      labels.columns.borrowedOutstanding,
      labels.columns.lentOutstanding,
      labels.columns.installmentOutstanding,
      labels.columns.receivableOutstanding,
    ]));
    for (let column = 6; column <= 10; column++) expect(formulaAt(sheet, 5, column).formula).toContain("Table");
    expect(sheet.getCell("A8").value).toBeNull();
  });

  it("adds control counts and source totals to Checks and Definitions", () => {
    const sheet = buildExportWorkbook(fixture()).getWorksheet("Checks & Definitions")!;
    const metrics = sheet.getColumn(1).values;
    expect(metrics).toContain("Transactions - records");
    expect(metrics).toContain("Wallet reconciliation difference - USD");
    const transactionRow = metrics.indexOf("Transactions - records");
    const differenceRow = metrics.indexOf("Wallet reconciliation difference - USD");
    expect(sheet.getCell(transactionRow, 2).value).toBe(1);
    expect(Number(formulaAt(sheet, differenceRow, 2).result)).toBe(0);
  });

  it("uses accounting formats, frozen detail headers, autofilters, and exception-only reconciliation formatting", () => {
    const workbook = buildExportWorkbook(fixture());
    const transactions = workbook.getWorksheet("Transactions")!;
    const amount = transactions.getCell(5, columnAt(transactions, "Amount"));
    expect(amount.numFmt).toBe("#,##0.00;(#,##0.00);-");
    expect(transactions.views[0]).toMatchObject({ state: "frozen", ySplit: 4, showGridLines: false });
    expect(transactions.getTable("TransactionsTable").getColumn(0).filterButton).toBe(true);
    const reconciliation = workbook.getWorksheet("Reconciliation")!;
    expect((reconciliation as unknown as { conditionalFormattings: unknown[] }).conditionalFormattings).toHaveLength(1);
    expect(reconciliation.getRow(4).getCell(1).fill).toMatchObject({ type: "pattern", fgColor: { argb: "FF28574F" } });
  });

  it("writes a readable xlsx buffer that ExcelJS can load again", async () => {
    const buffer = await writeExportWorkbook(fixture("ar"));
    expect(buffer.byteLength).toBeGreaterThan(10_000);
    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(buffer as unknown as Parameters<typeof reloaded.xlsx.load>[0]);
    expect(reloaded.worksheets.map((sheet) => sheet.name)).toEqual(ARABIC_SHEETS);
    expect(Number((reloaded.getWorksheet("التسوية")?.getCell("J5").value as { result: string }).result)).toBe(0);
  });
});
