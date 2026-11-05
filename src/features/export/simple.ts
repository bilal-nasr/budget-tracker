import "server-only";

import ExcelJS, { type CellValue } from "exceljs";
import { buildCycles, cycleDays, pickCycle } from "@/features/budgets/cycles";
import { requireCurrency } from "@/lib/currency";
import { sumMinor } from "@/lib/money";
import { getExportLabels } from "./labels";
import { historicalExportBalances, type ExportData, type WalletLedgerRow } from "./model";
import type { SimpleExportOptions } from "./options";
import { buildWalletLedger, minorToMajor } from "./schedules";
import { exportColors as colors } from "./workbook-style";

type Range = { from: string; to: string } | null;

/** The inclusive day range the workbook covers; null means all time. */
export function simpleRange(data: ExportData, period: SimpleExportOptions["period"]): { range: Range; kind: "cycle" | "month" | "all" } {
  if (period === "all") return { range: null, kind: "all" };
  const month = { from: `${data.cutoffDate.slice(0, 7)}-01`, to: data.cutoffDate };
  if (period === "cycle") {
    const salaryDays = data.transactions
      .filter((row) => row.source === "salary" && row.kind === "income")
      .map((row) => row.occurredOn);
    const cycle = pickCycle(buildCycles(salaryDays), null);
    // Before the first salary receipt the app counts by calendar month too.
    if (cycle) return { range: cycleDays(cycle, data.cutoffDate), kind: "cycle" };
  }
  return { range: month, kind: "month" };
}

function accountingFormat(decimals: number): string {
  const digits = decimals === 0 ? "" : `.${"0".repeat(decimals)}`;
  return `#,##0${digits};(#,##0${digits});-`;
}

function ledgerOrder(left: WalletLedgerRow, right: WalletLedgerRow): number {
  return left.occurredOn.localeCompare(right.occurredOn) || left.createdAt.localeCompare(right.createdAt) ||
    left.rowId.localeCompare(right.rowId);
}

/**
 * One worksheet: the current balance of each wallet (with a total per
 * currency) above the cash movements of the chosen period. Currencies are
 * never added together.
 */
export function buildSimpleWorkbook(data: ExportData, options: SimpleExportOptions): ExcelJS.Workbook {
  const labels = getExportLabels(data.locale);
  const text = labels.simple;
  const decimalsOf = (code: string) => requireCurrency(code, data.currencies).decimalPlaces;
  const { range, kind } = simpleRange(data, options.period);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Budget Tracker";
  workbook.created = new Date(data.exportedAt.valueOf());
  workbook.modified = new Date(data.exportedAt.valueOf());
  const sheet = workbook.addWorksheet(text.sheet, { views: [{ showGridLines: false, rightToLeft: data.locale === "ar" }] });

  sheet.getCell("A2").value = text.sheet;
  const periodLabel = kind === "all" ? text.allTime
    : `${kind === "cycle" ? text.cycle : text.month}: ${range!.from} – ${range!.to}`;
  sheet.getCell("A3").value = `${periodLabel}  ·  ${labels.values.cutoff}: ${data.cutoffDate}`;

  type Block = { header: number; first: number; last: number; moneyColumns: number[]; currencyColumn: number; kindOf: "balance" | "ledger" };
  const blocks: Block[] = [];
  const headings: number[] = [];
  let row = 4;

  if (options.balances) {
    const balances = historicalExportBalances(data.wallets, data.currencies)
      .filter((balance) => !balance.archived && balance.balanceMinor !== 0)
      .sort((a, b) => a.walletPosition - b.walletPosition || a.position - b.position || a.id.localeCompare(b.id));
    const totals = new Map<string, number[]>();
    for (const balance of balances) totals.set(balance.currency, [...(totals.get(balance.currency) ?? []), balance.balanceMinor]);
    const rows: CellValue[][] = [
      ...balances.map((balance) => [balance.name, balance.currency, minorToMajor(balance.balanceMinor, requireCurrency(balance.currency, data.currencies))]),
      ...[...totals].map(([currency, values]) => [text.total, currency, minorToMajor(sumMinor(values), requireCurrency(currency, data.currencies))]),
    ];
    sheet.addTable({
      name: "CurrentBalanceTable", ref: `A${row}`, headerRow: true, totalsRow: false,
      style: { theme: "TableStyleDark9", showRowStripes: true, showFirstColumn: false, showLastColumn: false },
      columns: [labels.columns.walletName, labels.columns.currency, text.balance].map((name) => ({ name, filterButton: true })),
      rows: rows.length > 0 ? rows : [[null, null, null]],
    });
    const count = Math.max(1, rows.length);
    blocks.push({ header: row, first: row + 1, last: row + count, moneyColumns: [3], currencyColumn: 2, kindOf: "balance" });
    row += count + 1 + 1;
  }

  const ledger = buildWalletLedger(data)
    .filter((entry) => range === null || (entry.occurredOn >= range.from && entry.occurredOn <= range.to))
    .sort(ledgerOrder);
  const enumLabel = (value: string) => labels.enums[value] ?? value;
  if (options.balances) {
    sheet.getCell(row, 1).value = text.transactions;
    headings.push(row);
    row += 1;
  }
  const columns = [labels.columns.date, labels.columns.type, labels.columns.categoryName, labels.columns.walletName,
    labels.columns.currency, labels.columns.inflow, labels.columns.outflow, ...(options.notes ? [labels.columns.note] : [])];
  const rows: CellValue[][] = ledger.map((entry) => [
    new Date(`${entry.occurredOn}T00:00:00Z`), enumLabel(entry.leg), entry.categoryName, entry.walletName, entry.currency,
    entry.inflowMinor === 0 ? null : minorToMajor(entry.inflowMinor, requireCurrency(entry.currency, data.currencies)),
    entry.outflowMinor === 0 ? null : minorToMajor(entry.outflowMinor, requireCurrency(entry.currency, data.currencies)),
    ...(options.notes ? [entry.note] : []),
  ]);
  sheet.addTable({
    name: "CycleTransactionsTable", ref: `A${row}`, headerRow: true, totalsRow: false,
    style: { theme: "TableStyleDark9", showRowStripes: true, showFirstColumn: false, showLastColumn: false },
    columns: columns.map((name) => ({ name, filterButton: true })),
    rows: rows.length > 0 ? rows : [columns.map(() => null)],
  });
  const count = Math.max(1, rows.length);
  blocks.push({ header: row, first: row + 1, last: row + count, moneyColumns: [6, 7], currencyColumn: 5, kindOf: "ledger" });
  const lastRow = row + count;
  const dateColumn = 1;
  const noteColumn = options.notes ? columns.length : null;

  // Number formats follow each row's own currency.
  for (const block of blocks) {
    for (let r = block.first; r <= block.last; r++) {
      const currency = String(sheet.getCell(r, block.currencyColumn).value ?? "");
      if (!currency) continue;
      for (const column of block.moneyColumns) sheet.getCell(r, column).numFmt = accountingFormat(decimalsOf(currency));
      if (block.kindOf === "ledger") sheet.getCell(r, dateColumn).numFmt = "dd-mmm-yyyy";
    }
  }

  // Styling mirrors the detailed workbook: dark canvas, teal headers, banded rows.
  const lastColumn = Math.max(3, columns.length);
  sheet.mergeCells(2, 1, 2, lastColumn);
  sheet.mergeCells(3, 1, 3, lastColumn);
  sheet.properties.tabColor = { argb: colors.accent };
  sheet.properties.defaultRowHeight = 28;
  sheet.views = [{ showGridLines: false, rightToLeft: data.locale === "ar", zoomScale: 100 }];
  for (let column = 1; column <= lastColumn; column++) {
    let width = 14;
    sheet.getColumn(column).eachCell({ includeEmpty: false }, (cell) => {
      if (cell.isMerged || Number(cell.row) < 4) return;
      const value = cell.value instanceof Date ? "00-Mmm-0000" : cell.text;
      width = Math.max(width, Math.min(column === noteColumn ? 48 : 36, value.length + 6));
    });
    sheet.getColumn(column).width = width;
  }
  const headerRows = new Set(blocks.map((block) => block.header));
  const dataRows = new Set(blocks.flatMap((block) => Array.from({ length: block.last - block.first + 1 }, (_, i) => block.first + i)));
  const totalRows = new Set<number>();
  if (options.balances) {
    const block = blocks[0];
    for (let r = block.first; r <= block.last; r++) if (sheet.getCell(r, 1).value === text.total) totalRows.add(r);
  }
  for (let r = 1; r <= lastRow; r++) {
    const isTitle = r === 2;
    const isNote = r === 3;
    const isHeader = headerRows.has(r);
    const isHeading = headings.includes(r);
    const isData = dataRows.has(r);
    const fill = isTitle ? colors.title : isHeader ? colors.header : isData ? (r % 2 === 0 ? colors.alternate : colors.surface) : colors.canvas;
    const color = isTitle ? colors.accent : isNote ? colors.muted : isHeading ? colors.accent : colors.text;
    const bold = isTitle || isHeader || isHeading || totalRows.has(r);
    let lines = 1;
    for (let column = 1; column <= lastColumn; column++) {
      const cell = sheet.getCell(r, column);
      cell.style = {
        numFmt: cell.numFmt,
        fill: { type: "pattern", pattern: "solid", fgColor: { argb: fill } },
        font: { name: "Aptos", size: isTitle ? 17 : isHeading ? 13 : 11, bold, color: { argb: color } },
        alignment: {
          horizontal: isTitle || isNote || isHeading ? undefined : "center", vertical: "middle",
          wrapText: isData && column === noteColumn,
        },
        ...(isHeader || isData ? { border: { bottom: { style: "thin" as const, color: { argb: colors.border } } } } : {}),
      };
      if (isData && column === noteColumn && typeof cell.value === "string") {
        const capacity = Math.max(1, (sheet.getColumn(column).width ?? 14) - 4);
        lines = Math.max(lines, Math.ceil(cell.value.length / capacity));
      }
    }
    sheet.getRow(r).height = isTitle ? 48 : isHeader ? 36 : Math.max(28, lines * 18 + 10);
  }
  return workbook;
}
