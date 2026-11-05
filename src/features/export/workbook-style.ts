import type ExcelJS from "exceljs";

export const exportColors = {
  canvas: "FF101827", surface: "FF172436", alternate: "FF1D2D41",
  header: "FF28574F", title: "FF183D3B", text: "FFE7EEF7",
  muted: "FFB2C2D2", accent: "FF85DDCA", border: "FF304257",
};

function displayText(cell: ExcelJS.Cell): string {
  if (cell.value instanceof Date) return cell.numFmt.includes("hh") ? "05-Nov-2026 08:00" : "05-Nov-2026";
  return cell.text;
}

function wrappedLines(text: string, width: number): number {
  const capacity = Math.max(1, Math.floor(width - 6));
  if (!/\s/u.test(text)) return Math.max(1, Math.ceil(text.length / capacity));
  return text.split(/\r\n|\r|\n/).reduce((total, paragraph) => {
    let lines = 1;
    let used = 0;
    for (const word of paragraph.split(/\s+/u)) {
      const length = word.length;
      if (used && used + 1 + length > capacity) { lines++; used = 0; }
      const occupied = used + (used ? 1 : 0) + length;
      lines += Math.max(0, Math.ceil(occupied / capacity) - 1);
      used = occupied === 0 ? 0 : ((occupied - 1) % capacity) + 1;
    }
    return total + lines;
  }, 0);
}

function mergedWidth(sheet: ExcelJS.Worksheet, cell: ExcelJS.Cell): number {
  let width = sheet.getColumn(cell.col).width ?? 14;
  for (let column = Number(cell.col) + 1; column <= sheet.columnCount; column++) {
    const next = sheet.getCell(cell.row, column);
    if (!next.isMerged || next.master.address !== cell.address) break;
    width += sheet.getColumn(column).width ?? 14;
  }
  return width;
}

export function applyExportWorkbookStyle(workbook: ExcelJS.Workbook, locale: "en" | "ar"): void {
  // ExcelJS caches serialized styles by object identity. Reusing these keeps
  // large exports fast and avoids thousands of duplicate formatting objects.
  const styles = new Map<string, Partial<ExcelJS.Style>>();
  for (const [index, sheet] of workbook.worksheets.entries()) {
    const cover = index === 0;
    const summary = index === 1;
    if (cover) {
      // Keep metadata and long explanatory notes inside deliberate merged
      // panels instead of relying on text overflowing into adjacent cells.
      for (const row of [5, 6, 7]) {
        const original = sheet.getCell(row, 2);
        const value = original.value;
        const numberFormat = original.numFmt;
        original.value = null;
        sheet.mergeCells(row, 1, row, 2);
        sheet.mergeCells(row, 3, row, 8);
        sheet.getCell(row, 3).value = value;
        sheet.getCell(row, 3).numFmt = numberFormat;
      }
      for (let row = 10; row <= 13; row++) sheet.mergeCells(row, 1, row, 8);
    }
    const lastColumn = Math.max(cover ? 8 : 2, sheet.columnCount);
    const lastRow = sheet.rowCount;
    sheet.mergeCells(2, 1, 2, Math.min(cover ? 8 : 6, lastColumn));
    sheet.properties.tabColor = { argb: summary || cover ? exportColors.accent : exportColors.header };
    sheet.properties.defaultRowHeight = 28;
    sheet.views = [{
      ...(cover ? {} : { state: "frozen" as const, ySplit: 4 }),
      showGridLines: false, rightToLeft: locale === "ar", zoomScale: 90,
    }];

    for (let column = 1; column <= lastColumn; column++) {
      let width = 16;
      sheet.getColumn(column).eachCell({ includeEmpty: false }, (cell) => {
        if (cell.isMerged || Number(cell.row) < 4) return;
        const longest = Math.max(...displayText(cell).split(/\r\n|\r|\n/).map((line) => line.length));
        width = Math.max(width, Math.min(56, longest + 6), Math.min(255, Math.ceil(longest / 18) + 6));
      });
      sheet.getColumn(column).width = cover ? (column === 1 ? 24 : 16) : width;
    }

    for (let rowNumber = 1; rowNumber <= lastRow; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const isHeader = !cover && rowNumber === 4;
      const isTitle = rowNumber === 2;
      const isData = rowNumber >= 5;
      const fill = isTitle ? exportColors.title : isHeader ? exportColors.header :
        isData ? (rowNumber % 2 === 0 ? exportColors.alternate : exportColors.surface) : exportColors.canvas;
      const color = isTitle ? exportColors.accent : cover && rowNumber >= 10 ? exportColors.muted : exportColors.text;
      const bold = isTitle || isHeader || (summary && isData);
      let lines = 1;
      for (let column = 1; column <= lastColumn; column++) {
        const cell = row.getCell(column);
        if (cell.isMerged && cell.master.address !== cell.address) continue;
        const key = `${fill}:${color}:${bold}:${isTitle}:${isHeader || isData}:${cell.numFmt}`;
        let style = styles.get(key);
        if (!style) {
          style = {
            numFmt: cell.numFmt,
            fill: { type: "pattern", pattern: "solid", fgColor: { argb: fill } },
            font: { name: "Aptos", size: isTitle ? 17 : 11, bold, color: { argb: color } },
            alignment: { horizontal: "center", vertical: "middle", wrapText: true, shrinkToFit: false },
            ...(isHeader || isData ? { border: { bottom: { style: "thin" as const, color: { argb: exportColors.border } } } } : {}),
          };
          styles.set(key, style);
        }
        cell.style = style;
        const width = cell.isMerged ? mergedWidth(sheet, cell) : sheet.getColumn(column).width ?? 16;
        lines = Math.max(lines, wrappedLines(displayText(cell), width));
      }
      row.height = Math.min(409.5, Math.max(isTitle ? 48 : isHeader ? 40 : 28, lines * 18 + 14));
    }
  }
}
