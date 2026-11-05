import ExcelJS from "exceljs";
import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: () => false }));

import { getExportData } from "./data";
import { writeExportWorkbook } from "./workbook";

type SavedTable = { model: { name: string; tableRef: string; autoFilterRef: string } };

it.each(["en", "ar"] as const)("writes Excel-compatible table ranges for empty and populated %s schedules", async (locale) => {
  const populated = await getExportData(locale, new Date("2026-11-05T08:00:00Z"));
  const empty = {
    ...populated, profile: { ...populated.profile, salary: null },
    wallets: [], categories: [], transactions: [], budgetRevisions: [], fixedExpenses: [],
    installments: [], loans: [], pendingPayments: [], pendingReceipts: [],
  };
  for (const data of [empty, populated]) {
    const buffer = await writeExportWorkbook(data);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const tables = workbook.worksheets.flatMap((sheet) => sheet.getTables() as unknown as SavedTable[]);
    expect(tables.length).toBeGreaterThan(10);
    for (const { model } of tables) {
      // ExcelJS can reload header-only tables, but Microsoft Excel repairs them.
      // Check the ranges read from the serialized file, including the filter.
      for (const reference of [model.tableRef, model.autoFilterRef]) {
        const range = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(reference);
        expect(range, `${model.name}: ${reference}`).not.toBeNull();
        expect(Number(range![4]), `${model.name} needs a data row`).toBeGreaterThan(Number(range![2]));
      }
    }
    if (data === empty) {
      const transactions = workbook.getWorksheet(locale === "en" ? "Transactions" : "المعاملات")!;
      transactions.getRow(5).eachCell({ includeEmpty: true }, (cell) => expect(cell.value).toBeNull());
      const checks = workbook.getWorksheet(locale === "en" ? "Checks & Definitions" : "الفحوص والتعريفات")!;
      expect(checks.getCell("B5").value).toBe(0);
    }
  }
});
