import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { emptyTransactionMetadata, type Transaction } from "@/features/transactions/schema";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
import type { ExportData } from "./model";
import { DEFAULT_SIMPLE } from "./options";
import { singleBalanceWallets } from "./test-fixtures";
vi.mock("server-only", () => ({}));
import { buildExportWorkbook, writeExportWorkbook } from "./workbook";
import { buildSimpleWorkbook } from "./simple";

function tx(overrides: Partial<Transaction> & Pick<Transaction, "id" | "kind" | "amountMinor" | "occurredOn">): Transaction {
  return {
    ...emptyTransactionMetadata(), currency: "USD", balanceId: "usd", categoryId: null, toBalanceId: null,
    toAmountMinor: null, note: null, createdAt: `${overrides.occurredOn}T10:00:00Z`, ...overrides,
  };
}

function fixture(locale: "en" | "ar" = "en"): ExportData {
  return {
    locale, timezone: "Asia/Beirut", exportedAt: new Date("2026-11-05T08:00:00Z"), cutoffDate: "2026-11-05",
    profile: { locale, digits: "latin", theme: "light", timezone: "Asia/Beirut", onboarded: true, usdLbpRate: null,
      salary: { amountMinor: 200_000, balanceId: "usd" } },
    currencies: SEED_CURRENCY_DEFINITIONS,
    wallets: singleBalanceWallets([
      { id: "usd", name: "Main wallet", kind: "bank", currency: "USD", openingBalanceMinor: 0, balanceMinor: 123_456, position: 1, archived: false },
      { id: "usd2", name: "Cash box", kind: "cash", currency: "USD", openingBalanceMinor: 0, balanceMinor: 1_000, position: 2, archived: false },
      { id: "lbp", name: "Lira", kind: "cash", currency: "LBP", openingBalanceMinor: 0, balanceMinor: 90_000, position: 3, archived: false },
      { id: "zero", name: "Empty", kind: "cash", currency: "USD", openingBalanceMinor: 0, balanceMinor: 0, position: 4, archived: false },
    ]),
    categories: [{ id: "cat", kind: "expense", nameEn: "Food", nameAr: "طعام", tile: 1, color: "teal", position: 1, parentId: null, archivedAt: null }],
    transactions: [
      tx({ id: "old-salary", kind: "income", source: "salary", amountMinor: 200_000, occurredOn: "2026-09-26" }),
      tx({ id: "old-food", kind: "expense", amountMinor: 700, occurredOn: "2026-10-10", categoryId: "cat", note: "previous cycle" }),
      tx({ id: "salary", kind: "income", source: "salary", amountMinor: 200_000, occurredOn: "2026-10-26" }),
      tx({ id: "food", kind: "expense", amountMinor: 1_250, occurredOn: "2026-10-28", categoryId: "cat", note: "lunch" }),
      tx({ id: "lbp-food", kind: "expense", amountMinor: 50_000, currency: "LBP", balanceId: "lbp", occurredOn: "2026-11-02", categoryId: "cat" }),
    ],
    budgetRevisions: [], fixedExpenses: [], installments: [], loans: [], pendingPayments: [], pendingReceipts: [],
  };
}

const sheetRows = (sheet: ExcelJS.Worksheet) =>
  Array.from({ length: sheet.rowCount }, (_, i) => (sheet.getRow(i + 1).values as unknown[]).slice(1));

describe("simple workbook", () => {
  it("has a single sheet with the current balances and the open pay cycle's transactions only", () => {
    const workbook = buildSimpleWorkbook(fixture(), DEFAULT_SIMPLE);
    expect(workbook.worksheets).toHaveLength(1);
    const sheet = workbook.worksheets[0];
    const text = JSON.stringify(sheetRows(sheet));
    expect(text).toContain("2026-10-26 – 2026-11-05");
    expect(text).toContain("lunch");
    expect(text).not.toContain("previous cycle");
    // Zero balances are left out; totals are per currency, never mixed.
    expect(text).not.toContain("Empty");
    expect(sheet.getTable("CurrentBalanceTable")).toBeTruthy();
    const totals = sheetRows(sheet).filter((row) => row[0] === "Total");
    expect(totals).toEqual([["Total", "USD", 1244.56], ["Total", "LBP", 90_000]]);
  });

  it("drops the balance table and the note column when switched off", () => {
    const sheet = buildSimpleWorkbook(fixture(), { ...DEFAULT_SIMPLE, balances: false, notes: false }).worksheets[0];
    const text = JSON.stringify(sheetRows(sheet));
    expect(text).not.toContain("Total");
    expect(text).not.toContain("lunch");
    expect(sheet.getTable("CurrentBalanceTable")).toBeUndefined();
    expect(sheet.getRow(4).values).not.toContain("Note");
  });

  it("covers all time or the calendar month on request", () => {
    const all = JSON.stringify(sheetRows(buildSimpleWorkbook(fixture(), { ...DEFAULT_SIMPLE, period: "all" }).worksheets[0]));
    expect(all).toContain("previous cycle");
    const month = JSON.stringify(sheetRows(buildSimpleWorkbook(fixture(), { ...DEFAULT_SIMPLE, period: "month" }).worksheets[0]));
    expect(month).toContain("2026-11-01 – 2026-11-05");
    expect(month).not.toContain("lunch");
  });

  it("falls back to the calendar month before any salary is recorded", () => {
    const data = { ...fixture(), transactions: fixture().transactions.filter((row) => row.source !== "salary") };
    const text = JSON.stringify(sheetRows(buildSimpleWorkbook(data, DEFAULT_SIMPLE).worksheets[0]));
    expect(text).toContain("2026-11-01 – 2026-11-05");
  });

  it("writes a readable Arabic right-to-left file", async () => {
    const buffer = await writeExportWorkbook(fixture("ar"), { ...DEFAULT_SIMPLE });
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buffer as unknown as Parameters<typeof loaded.xlsx.load>[0]);
    expect(loaded.worksheets).toHaveLength(1);
    expect(loaded.worksheets[0].name).toBe("الدورة والرصيد");
    expect(loaded.worksheets[0].views[0].rightToLeft).toBe(true);
  });
});

describe("detailed workbook section selection", () => {
  it("keeps only the chosen groups plus the cover", () => {
    const workbook = buildExportWorkbook(fixture(), ["transactions"]);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Cover", "Wallet Ledger", "Transactions", "Expense Items"]);
  });

  it("replaces formulas that would point at removed tables with their calculated values", async () => {
    const workbook = buildExportWorkbook(fixture(), ["overview"]);
    const summary = workbook.getWorksheet("Financial Summary")!;
    for (const cell of [summary.getCell("B5"), summary.getCell("C5"), summary.getCell("G5")]) {
      expect(typeof cell.value).toBe("number");
    }
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await workbook.xlsx.writeBuffer() as unknown as Parameters<typeof loaded.xlsx.load>[0]);
    expect(loaded.worksheets.map((sheet) => sheet.name)).toEqual(["Cover", "Financial Summary", "Checks & Definitions"]);
  });

  it("keeps live formulas when the tables they read are kept", () => {
    const workbook = buildExportWorkbook(fixture(), ["overview", "wallets", "transactions", "budgets", "debts", "recurring"]);
    const value = workbook.getWorksheet("Financial Summary")!.getCell("B5").value as { formula?: string };
    expect(value.formula).toContain("ReconciliationTable");
  });
});
