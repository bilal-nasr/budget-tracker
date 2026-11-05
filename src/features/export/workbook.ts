import "server-only";

import ExcelJS, { type CellValue, type TableColumnProperties } from "exceljs";
import { categoryName } from "@/features/categories/schema";
import { buildExportSchedules, minorToMajor } from "./schedules";
import { getExportLabels, SHEET_KEYS, type SheetKey } from "./labels";
import { historicalExportBalances, type ExportData } from "./model";
import { requireCurrency } from "@/lib/currency";

import { applyExportWorkbookStyle } from "./workbook-style";
import { buildSimpleWorkbook } from "./simple";
import { DEFAULT_DETAILED, SECTION_GROUPS, selectedSheets, type ExportOptions, type SectionGroup } from "./options";

type TableColumn = { key: string; label: string };

function dateValue(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00Z`);
}

function monthValue(value: string): Date {
  return new Date(`${value}-01T00:00:00Z`);
}

/** Excel table backing each worksheet that other sheets' formulas read from. */
const FORMULA_SOURCES: Array<[table: string, sheet: SheetKey]> = [
  ["WalletLedgerTable", "walletLedger"], ["ReconciliationTable", "reconciliation"],
  ["MonthlyActivityTable", "monthlyActivity"], ["BudgetActualTable", "budgetActual"],
  ["LoansTable", "loans"], ["InstallmentsTable", "installments"], ["ReceivablesTable", "receivables"],
];

/**
 * The full workbook is always built so every figure is computed the same way,
 * then worksheets outside `sections` are dropped. A formula that would read a
 * dropped table keeps its calculated value instead of a broken reference.
 */
export function buildExportWorkbook(data: ExportData, sections: readonly SectionGroup[] = SECTION_GROUPS): ExcelJS.Workbook {
  const kept = selectedSheets(sections);
  const labels = getExportLabels(data.locale);
  const balances = historicalExportBalances(data.wallets, data.currencies);
  const currencies = data.currencies.map((currency) => currency.code);
  const definition = (code: string) => requireCurrency(code, data.currencies);
  const money = (value: number | null, currency: string): number | null => value === null ? null : minorToMajor(value, definition(currency));
  const schedules = buildExportSchedules(data);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Budget Tracker";
  workbook.created = new Date(data.exportedAt.valueOf());
  workbook.modified = new Date(data.exportedAt.valueOf());
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheets = new Map<SheetKey, ExcelJS.Worksheet>();
  for (const key of SHEET_KEYS) {
    const sheet = workbook.addWorksheet(labels.sheets[key], {
      views: [{ showGridLines: false, rightToLeft: data.locale === "ar" }],
    });
    sheets.set(key, sheet);
  }

  const title = (key: SheetKey) => {
    const sheet = sheets.get(key)!;
    sheet.getCell("A2").value = labels.sheets[key];
    return sheet;
  };
  const table = (key: SheetKey, name: string, columns: TableColumn[], rows: CellValue[][]) => {
    const sheet = title(key);
    sheet.addTable({
      name,
      ref: "A4",
      headerRow: true,
      totalsRow: false,
      style: { theme: "TableStyleDark9", showRowStripes: true, showFirstColumn: false, showLastColumn: false },
      columns: columns.map((column): TableColumnProperties => ({ name: column.label, filterButton: true })),
      // Excel repairs header-only tables. Keep an empty data row without
      // inventing records or numeric amounts for an empty schedule.
      rows: rows.length > 0 ? rows : [columns.map(() => null)],
    });
    return sheet;
  };

  const wallets = new Map(balances.map((balance) => [balance.id, balance]));
  const categories = new Map(data.categories.map((category) => [category.id, category]));
  const exactBalance = (id: string) => {
    const balance = wallets.get(id);
    if (!balance) throw new Error("export_data_unavailable");
    return balance;
  };
  const walletName = (id: string) => exactBalance(id).name;
  const categoryLabel = (id: string | null) => id ? (categories.get(id) ? categoryName(categories.get(id)!, data.locale) : id) : "";
  const yesNo = (value: boolean) => value ? labels.values.yes : labels.values.no;
  const budgetStatus = (value: "under" | "over" | "on" | "unbudgeted") => labels.values[value];
  const enumLabel = (value: string | null) => value === null ? "" : labels.enums[value] ?? value;

  const cover = title("cover");
  cover.getCell("A2").value = labels.values.workbookTitle;
  cover.getCell("A5").value = labels.values.exportedAt;
  cover.getCell("B5").value = new Date(data.exportedAt.valueOf());
  cover.getCell("A6").value = labels.values.cutoff;
  cover.getCell("B6").value = dateValue(data.cutoffDate);
  cover.getCell("A7").value = labels.values.timezone;
  cover.getCell("B7").value = data.timezone;
  [labels.values.sourceDescription, labels.values.cashBasis, labels.values.currencyRule, labels.values.limitation]
    .forEach((value, index) => { cover.getCell(10 + index, 1).value = value; });

  const summary = title("summary");
  summary.getRow(4).values = [labels.columns.currency, labels.columns.appClosing, labels.columns.operatingIncome,
    labels.columns.operatingExpense, labels.columns.budget, labels.columns.actual, labels.columns.borrowedOutstanding,
    labels.columns.lentOutstanding, labels.columns.installmentOutstanding, labels.columns.receivableOutstanding,
    labels.columns.netActivity];
  currencies.forEach((currency, index) => {
    const reconciliations = schedules.reconciliations.filter((row) => row.currency === currency);
    const activity = schedules.monthlyActivity.filter((row) => row.currency === currency);
    const budgets = schedules.budgetActuals.filter((row) => row.currency === currency);
    summary.getRow(5 + index).values = [currency,
      reconciliations.reduce((sum, row) => sum + money(row.exportedClosingMinor, currency)!, 0),
      activity.reduce((sum, row) => sum + money(row.operatingIncomeMinor, currency)!, 0),
      activity.reduce((sum, row) => sum + money(row.operatingExpenseMinor, currency)!, 0),
      budgets.reduce((sum, row) => sum + (money(row.limitMinor, currency) ?? 0), 0),
      budgets.reduce((sum, row) => sum + money(row.actualMinor, currency)!, 0),
      data.loans.filter((row) => row.currency === currency && row.direction === "borrowed")
        .reduce((sum, row) => sum + money(row.remainingMinor, currency)!, 0),
      data.loans.filter((row) => row.currency === currency && row.direction === "lent")
        .reduce((sum, row) => sum + money(row.remainingMinor, currency)!, 0),
      data.installments.filter((row) => row.currency === currency)
        .reduce((sum, row) => sum + money(row.remainingMinor, currency)!, 0),
      data.pendingPayments.filter((row) => row.currency === currency)
        .reduce((sum, row) => sum + money(row.remainingMinor, currency)!, 0),
      activity.reduce((sum, row) => sum + money(row.netWalletActivityMinor, currency)!, 0)];
  });

  table("reconciliation", "ReconciliationTable", [
    { key: "walletName", label: labels.columns.walletName }, { key: "balanceId", label: labels.columns.balanceId },
    { key: "currency", label: labels.columns.currency }, { key: "archived", label: labels.columns.archived },
    { key: "opening", label: labels.columns.openingBalance }, { key: "inflow", label: labels.columns.inflow },
    { key: "outflow", label: labels.columns.outflow }, { key: "calculated", label: labels.columns.calculatedClosing },
    { key: "app", label: labels.columns.appClosing }, { key: "difference", label: labels.columns.difference },
    { key: "walletId", label: labels.columns.walletId },
  ], schedules.reconciliations.map((row) => [row.walletName, row.balanceId, row.currency, yesNo(row.archived),
    money(row.openingBalanceMinor, row.currency), money(row.inflowMinor, row.currency), money(row.outflowMinor, row.currency),
    money(row.calculatedClosingMinor, row.currency), money(row.exportedClosingMinor, row.currency), money(row.differenceMinor, row.currency), row.walletId]));

  table("monthlyActivity", "MonthlyActivityTable", [
    { key: "month", label: labels.columns.month }, { key: "currency", label: labels.columns.currency },
    { key: "income", label: labels.columns.operatingIncome }, { key: "expense", label: labels.columns.operatingExpense },
    { key: "loanIn", label: labels.columns.loanIn }, { key: "loanOut", label: labels.columns.loanOut },
    { key: "transferIn", label: labels.columns.transferIn }, { key: "transferOut", label: labels.columns.transferOut },
    { key: "inflow", label: labels.columns.inflow }, { key: "outflow", label: labels.columns.outflow },
    { key: "net", label: labels.columns.netActivity },
  ], schedules.monthlyActivity.map((row) => [monthValue(row.month), row.currency,
    money(row.operatingIncomeMinor, row.currency), money(row.operatingExpenseMinor, row.currency), money(row.loanInMinor, row.currency),
    money(row.loanOutMinor, row.currency), money(row.transferInMinor, row.currency), money(row.transferOutMinor, row.currency),
    money(row.walletInflowMinor, row.currency), money(row.walletOutflowMinor, row.currency), money(row.netWalletActivityMinor, row.currency)]));

  table("walletLedger", "WalletLedgerTable", [
    { key: "date", label: labels.columns.date }, { key: "transactionId", label: labels.columns.transactionId },
    { key: "leg", label: labels.columns.leg }, { key: "wallet", label: labels.columns.walletName },
    { key: "balanceId", label: labels.columns.balanceId }, { key: "currency", label: labels.columns.currency },
    { key: "inflow", label: labels.columns.inflow }, { key: "outflow", label: labels.columns.outflow },
    { key: "category", label: labels.columns.categoryName }, { key: "categoryId", label: labels.columns.categoryId },
    { key: "note", label: labels.columns.note }, { key: "source", label: labels.columns.source },
    { key: "fixed", label: labels.columns.fixedExpenseId }, { key: "installment", label: labels.columns.installmentId },
    { key: "loan", label: labels.columns.loanId }, { key: "receivable", label: labels.columns.receivableId },
    { key: "walletId", label: labels.columns.walletId },
  ], schedules.walletLedger.map((row) => [dateValue(row.occurredOn), row.transactionId, enumLabel(row.leg), row.walletName, row.balanceId,
    row.currency, money(row.inflowMinor, row.currency), money(row.outflowMinor, row.currency), row.categoryName, row.categoryId,
    row.note, enumLabel(row.source), row.fixedExpenseId, row.installmentId, row.loanId, row.pendingPaymentId, row.walletId]));

  table("budgetActual", "BudgetActualTable", [
    { key: "month", label: labels.columns.month }, { key: "category", label: labels.columns.categoryName },
    { key: "categoryId", label: labels.columns.categoryId }, { key: "currency", label: labels.columns.currency },
    { key: "budget", label: labels.columns.budget }, { key: "actual", label: labels.columns.actual },
    { key: "variance", label: labels.columns.variance }, { key: "variancePct", label: labels.columns.variancePercent },
    { key: "status", label: labels.columns.status },
  ], schedules.budgetActuals.map((row) => [monthValue(row.month), row.categoryName, row.categoryId, row.currency,
    money(row.limitMinor, row.currency), money(row.actualMinor, row.currency), money(row.varianceMinor, row.currency),
    row.variancePercent, budgetStatus(row.status)]));

  table("transactions", "TransactionsTable", [
    { key: "date", label: labels.columns.date }, { key: "id", label: labels.columns.transactionId },
    { key: "type", label: labels.columns.type }, { key: "wallet", label: labels.columns.walletName },
    { key: "balanceId", label: labels.columns.balanceId }, { key: "category", label: labels.columns.categoryName },
    { key: "categoryId", label: labels.columns.categoryId }, { key: "currency", label: labels.columns.currency },
    { key: "amount", label: labels.columns.amount }, { key: "note", label: labels.columns.note },
    { key: "source", label: labels.columns.source }, { key: "revision", label: labels.columns.revision },
    { key: "toWallet", label: `${labels.columns.transferIn} ${labels.columns.walletName}` },
    { key: "toBalanceId", label: `${labels.columns.transferIn} ${labels.columns.balanceId}` },
    { key: "toCurrency", label: `${labels.columns.transferIn} ${labels.columns.currency}` },
    { key: "toAmount", label: `${labels.columns.transferIn} ${labels.columns.amount}` },
    { key: "fixed", label: labels.columns.fixedExpenseId }, { key: "installment", label: labels.columns.installmentId },
    { key: "loan", label: labels.columns.loanId }, { key: "receivable", label: labels.columns.receivableId },
    { key: "walletId", label: labels.columns.walletId },
    { key: "snapshot", label: labels.columns.walletNameSnapshot },
    { key: "toSnapshot", label: labels.columns.toWalletNameSnapshot },
  ], data.transactions.map((row) => [dateValue(row.occurredOn), row.id, enumLabel(row.kind), walletName(row.balanceId), row.balanceId,
    categoryLabel(row.categoryId), row.categoryId, row.currency, money(row.amountMinor, row.currency), row.note, enumLabel(row.source),
    row.revision, row.toBalanceId ? walletName(row.toBalanceId) : null, row.toBalanceId,
    row.toBalanceId ? exactBalance(row.toBalanceId).currency : null,
    row.toAmountMinor === null ? null : money(row.toAmountMinor, exactBalance(row.toBalanceId!).currency),
    row.fixedExpenseId, row.installmentId, row.loanId, row.pendingPaymentId ?? null, exactBalance(row.balanceId).walletId, row.walletNameSnapshot ?? null, row.toWalletNameSnapshot ?? null]));

  table("expenseItems", "ExpenseItemsTable", [
    { key: "transaction", label: labels.columns.transactionId }, { key: "id", label: labels.columns.id },
    { key: "description", label: labels.columns.description }, { key: "position", label: labels.columns.position },
    { key: "currency", label: labels.columns.currency }, { key: "amount", label: labels.columns.amount },
  ], data.transactions.flatMap((transaction) => transaction.items.map((item) => [transaction.id, item.id, item.description,
    item.position, transaction.currency, money(item.amountMinor, transaction.currency)])));

  table("wallets", "WalletsTable", [
    { key: "name", label: labels.columns.walletName }, { key: "id", label: labels.columns.walletId },
    { key: "type", label: labels.columns.walletKind }, { key: "default", label: labels.columns.defaultBalanceId },
    { key: "deleted", label: labels.columns.deleted }, { key: "attention", label: labels.columns.needsAttention },
    { key: "position", label: labels.columns.position },
  ], data.wallets.map((row) => [row.name, row.id, enumLabel(row.kind), row.defaultBalanceId,
    yesNo(row.deleted), yesNo(row.needsAttention), row.position]));

  table("currencies", "CurrenciesTable", [
    { key: "code", label: labels.columns.currency }, { key: "symbol", label: labels.columns.symbol },
    { key: "precision", label: labels.columns.decimalPlaces }, { key: "disabled", label: labels.columns.disabled },
    { key: "used", label: labels.columns.firstUsed },
  ], data.currencies.map((row) => [row.code, row.symbol, row.decimalPlaces, yesNo(row.disabled), yesNo(row.firstUsed)]));

  table("balances", "BalancesTable", [
    { key: "name", label: labels.columns.walletName }, { key: "id", label: labels.columns.balanceId },
    { key: "wallet", label: labels.columns.walletId }, { key: "currency", label: labels.columns.currency },
    { key: "opening", label: labels.columns.openingBalance }, { key: "closing", label: labels.columns.appClosing },
    { key: "detached", label: labels.columns.detached }, { key: "position", label: labels.columns.position },
    { key: "openingExact", label: `${labels.columns.openingBalance} ${labels.columns.exactMinor}` },
    { key: "closingExact", label: `${labels.columns.appClosing} ${labels.columns.exactMinor}` },
  ], balances.map((row) => [row.name, row.id, row.walletId, row.currency, money(row.openingBalanceMinor, row.currency),
    money(row.balanceMinor, row.currency), yesNo(row.detached), row.position, String(row.openingBalanceMinor), String(row.balanceMinor)]));

  table("categories", "CategoriesTable", [
    { key: "name", label: labels.columns.categoryName }, { key: "id", label: labels.columns.categoryId },
    { key: "kind", label: labels.columns.categoryKind }, { key: "parent", label: labels.columns.parentCategory },
    { key: "archived", label: labels.columns.archived }, { key: "position", label: labels.columns.position },
  ], data.categories.map((row) => [categoryName(row, data.locale), row.id, enumLabel(row.kind), categoryLabel(row.parentId),
    yesNo(row.archivedAt !== null), row.position]));

  const salary = data.profile.salary;
  table("salary", "SalaryTable", [
    { key: "wallet", label: labels.columns.walletName }, { key: "balanceId", label: labels.columns.balanceId },
    { key: "currency", label: labels.columns.currency }, { key: "amount", label: labels.columns.amount },
  ], salary && wallets.get(salary.balanceId) ? [[walletName(salary.balanceId), salary.balanceId, wallets.get(salary.balanceId)!.currency,
    money(salary.amountMinor, wallets.get(salary.balanceId)!.currency)]] : []);

  table("fixedExpenses", "FixedExpensesTable", [
    { key: "name", label: labels.columns.description }, { key: "id", label: labels.columns.id },
    { key: "wallet", label: labels.columns.walletName }, { key: "balanceId", label: labels.columns.balanceId },
    { key: "category", label: labels.columns.categoryName }, { key: "categoryId", label: labels.columns.categoryId },
    { key: "currency", label: labels.columns.currency }, { key: "amount", label: labels.columns.amount },
    { key: "due", label: labels.columns.dueDay },
  ], data.fixedExpenses.map((row) => {
    const currency = exactBalance(row.balanceId).currency;
    return [row.name, row.id, walletName(row.balanceId), row.balanceId, categoryLabel(row.categoryId), row.categoryId,
      currency, money(row.amountMinor, currency), row.dueDay];
  }));

  table("installments", "InstallmentsTable", [
    { key: "name", label: labels.columns.description }, { key: "id", label: labels.columns.installmentId },
    { key: "wallet", label: labels.columns.walletName }, { key: "category", label: labels.columns.categoryName },
    { key: "currency", label: labels.columns.currency }, { key: "total", label: labels.columns.total },
    { key: "before", label: labels.columns.paidBefore }, { key: "paid", label: labels.columns.paid },
    { key: "remaining", label: labels.columns.remaining }, { key: "monthly", label: labels.columns.monthlyPayment },
    { key: "due", label: labels.columns.dueDay }, { key: "status", label: labels.columns.status },
  ], data.installments.map((row) => [row.name, row.id, walletName(row.balanceId), categoryLabel(row.categoryId), row.currency,
    money(row.totalMinor, row.currency), money(row.paidBeforeMinor, row.currency), money(row.paidMinor, row.currency),
    money(row.remainingMinor, row.currency), money(row.monthlyMinor, row.currency), row.dueDay, enumLabel(row.cycleStatus)]));

  table("installmentPayments", "InstallmentPaymentsTable", [
    { key: "date", label: labels.columns.date }, { key: "transaction", label: labels.columns.transactionId },
    { key: "installment", label: labels.columns.installmentId }, { key: "wallet", label: labels.columns.walletName },
    { key: "currency", label: labels.columns.currency }, { key: "amount", label: labels.columns.amount },
  ], data.installments.flatMap((installment) => installment.payments.map((payment) => [dateValue(payment.occurredOn),
    payment.transactionId, installment.id, walletName(payment.balanceId), installment.currency, money(payment.amountMinor, installment.currency)])));

  table("loans", "LoansTable", [
    { key: "name", label: labels.columns.description }, { key: "id", label: labels.columns.loanId },
    { key: "direction", label: labels.columns.direction }, { key: "wallet", label: labels.columns.walletName },
    { key: "currency", label: labels.columns.currency }, { key: "opened", label: labels.columns.openedOn },
    { key: "principal", label: labels.columns.principal }, { key: "feeRate", label: labels.columns.feeRate },
    { key: "fee", label: labels.columns.fee }, { key: "total", label: labels.columns.totalDue },
    { key: "paid", label: labels.columns.paid }, { key: "remaining", label: labels.columns.remaining },
    { key: "archived", label: labels.columns.archived },
  ], data.loans.map((row) => [row.name, row.id, enumLabel(row.direction), walletName(row.balanceId), row.currency, dateValue(row.openedOn),
    money(row.principalMinor, row.currency), row.feeBps / 10_000, money(row.feeMinor, row.currency), money(row.totalDueMinor, row.currency),
    money(row.principalPaidMinor + row.feePaidMinor, row.currency), money(row.remainingMinor, row.currency), yesNo(row.archivedAt !== null)]));

  table("loanPayments", "LoanPaymentsTable", [
    { key: "date", label: labels.columns.date }, { key: "transaction", label: labels.columns.transactionId },
    { key: "loan", label: labels.columns.loanId }, { key: "type", label: labels.columns.type },
    { key: "wallet", label: labels.columns.walletName }, { key: "currency", label: labels.columns.currency },
    { key: "amount", label: labels.columns.amount }, { key: "principal", label: labels.columns.principal },
    { key: "fee", label: labels.columns.fee },
  ], data.transactions.filter((row) => row.kind === "loan").map((row) => [dateValue(row.occurredOn), row.id, row.loanId,
    enumLabel(row.loanEvent), walletName(row.balanceId), row.currency, money(row.amountMinor, row.currency),
    money(row.loanPrincipalMinor, row.currency), money(row.loanFeeMinor, row.currency)]));

  table("receivables", "ReceivablesTable", [
    { key: "client", label: labels.columns.client }, { key: "project", label: labels.columns.project },
    { key: "id", label: labels.columns.receivableId }, { key: "currency", label: labels.columns.currency },
    { key: "total", label: labels.columns.total }, { key: "received", label: labels.columns.received },
    { key: "remaining", label: labels.columns.remaining }, { key: "due", label: labels.columns.dueDate },
  ], data.pendingPayments.map((row) => [row.client, row.project, row.id, row.currency, money(row.totalMinor, row.currency),
    money(row.receivedMinor, row.currency), money(row.remainingMinor, row.currency), dateValue(row.dueOn)]));

  table("receipts", "ReceiptsTable", [
    { key: "date", label: labels.columns.date }, { key: "id", label: labels.columns.transactionId },
    { key: "receivable", label: labels.columns.receivableId }, { key: "wallet", label: labels.columns.walletName },
    { key: "category", label: labels.columns.categoryName }, { key: "currency", label: labels.columns.currency },
    { key: "amount", label: labels.columns.amount },
  ], data.pendingReceipts.map((row) => {
    const currency = exactBalance(row.balanceId).currency;
    return [dateValue(row.occurredOn), row.id, row.paymentId, walletName(row.balanceId), categoryLabel(row.categoryId),
      currency, money(row.amountMinor, currency)];
  }));

  // Exact facts use text cells: Excel numeric cells have only 15 significant digits.
  // Paths retain source identities and include every minor-unit field and snapshot.
  const facts: CellValue[][] = [];
  const collectFacts = (value: unknown, path: string, currency: string | null = null) => {
    if (!value || typeof value !== "object" || value instanceof Date) return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        const id = entry && typeof entry === "object" && "id" in entry ? String(entry.id) : String(index);
        collectFacts(entry, `${path}/${id}`, currency);
      });
      return;
    }
    const record = value as Record<string, unknown>;
    const balanceId = typeof record.balanceId === "string" && wallets.has(record.balanceId) ? record.balanceId : null;
    const unit = typeof record.currency === "string" ? record.currency : balanceId ? exactBalance(balanceId).currency : currency;
    for (const [key, entry] of Object.entries(record)) {
      const factUnit = key === "tenderMinor" && typeof record.tenderCurrency === "string" ? record.tenderCurrency
        : key === "toAmountMinor" && typeof record.toBalanceId === "string" ? exactBalance(record.toBalanceId).currency : unit;
      if (entry === null || ["string", "number", "boolean"].includes(typeof entry)) {
        facts.push([`${path}/${key}`, factUnit, entry === null ? null : String(entry)]);
      } else collectFacts(entry, `${path}/${key}`, unit);
    }
  };
  collectFacts(data, "source");
  collectFacts(schedules, "schedules");
  table("exactFacts", "ExactFactsTable", [
    { key: "path", label: labels.columns.factPath }, { key: "currency", label: labels.columns.currency },
    { key: "value", label: labels.columns.exactValue },
  ], facts);

  const recordChecks: Array<[string, number]> = [
    [labels.sheets.transactions, data.transactions.length],
    [labels.sheets.wallets, data.wallets.length],
    [labels.sheets.categories, data.categories.length],
    [labels.sheets.budgetActual, schedules.budgetActuals.length],
    [labels.sheets.fixedExpenses, data.fixedExpenses.length],
    [labels.sheets.installments, data.installments.length],
    [labels.sheets.loans, data.loans.length],
    [labels.sheets.receivables, data.pendingPayments.length],
    [labels.sheets.receipts, data.pendingReceipts.length],
  ];
  const checkRows: CellValue[][] = [
    ...recordChecks.map(([name, count]) => [`${name} - ${labels.values.records}`, count, labels.values.recordCounts]),
    ...currencies.map((currency) => [
      `${labels.values.walletDifference} - ${currency}`,
      schedules.reconciliations.filter((row) => row.currency === currency)
        .reduce((sum, row) => sum + money(row.differenceMinor, currency)!, 0),
      labels.values.reconciliationChecks,
    ]),
    ...currencies.flatMap((currency) => {
      const ledger = schedules.walletLedger.filter((row) => row.currency === currency);
      return [
        [`${labels.sheets.walletLedger} ${labels.columns.inflow} - ${currency}`,
          ledger.reduce((sum, row) => sum + money(row.inflowMinor, currency)!, 0), labels.values.reconciliationChecks],
        [`${labels.sheets.walletLedger} ${labels.columns.outflow} - ${currency}`,
          ledger.reduce((sum, row) => sum + money(row.outflowMinor, currency)!, 0), labels.values.reconciliationChecks],
      ];
    }),
    [labels.values.cashBasis, null, labels.values.cashBasis],
    [labels.values.currencyRule, null, labels.values.currencyRule],
    [labels.values.limitation, null, labels.values.limitation],
  ];
  const checksSheet = table("checks", "ChecksTable", [
    { key: "metric", label: labels.columns.metric }, { key: "value", label: labels.columns.value },
    { key: "definition", label: labels.columns.definition },
  ], checkRows);

  const tableColumn = (tableName: string, columnName: string) =>
    `${tableName}[${columnName.replace(/]/g, "]]" )}]`;
  const formula = (cell: ExcelJS.Cell, text: string, result: number) => {
    // ExcelJS 4.4 drops a numeric cached result of exactly zero. A visible
    // string cache plus fullCalcOnLoad preserves the display until Excel
    // replaces it with the calculated numeric result.
    const orphaned = FORMULA_SOURCES.some(([table, sheet]) => text.includes(`${table}[`) && !kept.has(sheet));
    cell.value = orphaned ? result : { formula: text, result: result === 0 ? "0" : result };
  };

  const reconciliationSheet = sheets.get("reconciliation")!;
  schedules.reconciliations.forEach((row, index) => {
    const excelRow = 5 + index;
    formula(reconciliationSheet.getCell(excelRow, 6),
      `SUMIFS(${tableColumn("WalletLedgerTable", labels.columns.inflow)},${tableColumn("WalletLedgerTable", labels.columns.balanceId)},$B${excelRow})`,
      money(row.inflowMinor, row.currency)!);
    formula(reconciliationSheet.getCell(excelRow, 7),
      `SUMIFS(${tableColumn("WalletLedgerTable", labels.columns.outflow)},${tableColumn("WalletLedgerTable", labels.columns.balanceId)},$B${excelRow})`,
      money(row.outflowMinor, row.currency)!);
    formula(reconciliationSheet.getCell(excelRow, 8), `E${excelRow}+F${excelRow}-G${excelRow}`,
      money(row.calculatedClosingMinor, row.currency)!);
    formula(reconciliationSheet.getCell(excelRow, 10), `H${excelRow}-I${excelRow}`,
      money(row.differenceMinor, row.currency)!);
  });

  currencies.forEach((currency, index) => {
    const excelRow = 5 + index;
    const reconciliations = schedules.reconciliations.filter((row) => row.currency === currency);
    const activity = schedules.monthlyActivity.filter((row) => row.currency === currency);
    formula(summary.getCell(excelRow, 2),
      `SUMIFS(${tableColumn("ReconciliationTable", labels.columns.appClosing)},${tableColumn("ReconciliationTable", labels.columns.currency)},$A${excelRow})`,
      reconciliations.reduce((sum, row) => sum + money(row.exportedClosingMinor, currency)!, 0));
    formula(summary.getCell(excelRow, 3),
      `SUMIFS(${tableColumn("MonthlyActivityTable", labels.columns.operatingIncome)},${tableColumn("MonthlyActivityTable", labels.columns.currency)},$A${excelRow})`,
      activity.reduce((sum, row) => sum + money(row.operatingIncomeMinor, currency)!, 0));
    formula(summary.getCell(excelRow, 4),
      `SUMIFS(${tableColumn("MonthlyActivityTable", labels.columns.operatingExpense)},${tableColumn("MonthlyActivityTable", labels.columns.currency)},$A${excelRow})`,
      activity.reduce((sum, row) => sum + money(row.operatingExpenseMinor, currency)!, 0));
    formula(summary.getCell(excelRow, 5),
      `SUMIFS(${tableColumn("BudgetActualTable", labels.columns.budget)},${tableColumn("BudgetActualTable", labels.columns.currency)},$A${excelRow})`,
      schedules.budgetActuals.filter((row) => row.currency === currency)
        .reduce((sum, row) => sum + (money(row.limitMinor, currency) ?? 0), 0));
    formula(summary.getCell(excelRow, 6),
      `SUMIFS(${tableColumn("BudgetActualTable", labels.columns.actual)},${tableColumn("BudgetActualTable", labels.columns.currency)},$A${excelRow})`,
      schedules.budgetActuals.filter((row) => row.currency === currency)
        .reduce((sum, row) => sum + money(row.actualMinor, currency)!, 0));
    formula(summary.getCell(excelRow, 7),
      `SUMIFS(${tableColumn("LoansTable", labels.columns.remaining)},${tableColumn("LoansTable", labels.columns.currency)},$A${excelRow},${tableColumn("LoansTable", labels.columns.direction)},"${enumLabel("borrowed")}")`,
      data.loans.filter((row) => row.currency === currency && row.direction === "borrowed")
        .reduce((sum, row) => sum + money(row.remainingMinor, currency)!, 0));
    formula(summary.getCell(excelRow, 8),
      `SUMIFS(${tableColumn("LoansTable", labels.columns.remaining)},${tableColumn("LoansTable", labels.columns.currency)},$A${excelRow},${tableColumn("LoansTable", labels.columns.direction)},"${enumLabel("lent")}")`,
      data.loans.filter((row) => row.currency === currency && row.direction === "lent")
        .reduce((sum, row) => sum + money(row.remainingMinor, currency)!, 0));
    formula(summary.getCell(excelRow, 9),
      `SUMIFS(${tableColumn("InstallmentsTable", labels.columns.remaining)},${tableColumn("InstallmentsTable", labels.columns.currency)},$A${excelRow})`,
      data.installments.filter((row) => row.currency === currency)
        .reduce((sum, row) => sum + money(row.remainingMinor, currency)!, 0));
    formula(summary.getCell(excelRow, 10),
      `SUMIFS(${tableColumn("ReceivablesTable", labels.columns.remaining)},${tableColumn("ReceivablesTable", labels.columns.currency)},$A${excelRow})`,
      data.pendingPayments.filter((row) => row.currency === currency)
        .reduce((sum, row) => sum + money(row.remainingMinor, currency)!, 0));
    formula(summary.getCell(excelRow, 11),
      `SUMIFS(${tableColumn("MonthlyActivityTable", labels.columns.netActivity)},${tableColumn("MonthlyActivityTable", labels.columns.currency)},$A${excelRow})`,
      activity.reduce((sum, row) => sum + money(row.netWalletActivityMinor, currency)!, 0));
  });

  currencies.forEach((currency, index) => {
    const excelRow = 5 + recordChecks.length + index;
    const result = schedules.reconciliations.filter((row) => row.currency === currency)
      .reduce((sum, row) => sum + money(row.differenceMinor, currency)!, 0);
    formula(checksSheet.getCell(excelRow, 2),
      `SUMIFS(${tableColumn("ReconciliationTable", labels.columns.difference)},${tableColumn("ReconciliationTable", labels.columns.currency)},"${currency}")`,
      result);
  });
  currencies.forEach((currency, currencyIndex) => {
    const firstRow = 5 + recordChecks.length + currencies.length + currencyIndex * 2;
    const ledger = schedules.walletLedger.filter((row) => row.currency === currency);
    formula(checksSheet.getCell(firstRow, 2),
      `SUMIFS(${tableColumn("WalletLedgerTable", labels.columns.inflow)},${tableColumn("WalletLedgerTable", labels.columns.currency)},"${currency}")`,
      ledger.reduce((sum, row) => sum + money(row.inflowMinor, currency)!, 0));
    formula(checksSheet.getCell(firstRow + 1, 2),
      `SUMIFS(${tableColumn("WalletLedgerTable", labels.columns.outflow)},${tableColumn("WalletLedgerTable", labels.columns.currency)},"${currency}")`,
      ledger.reduce((sum, row) => sum + money(row.outflowMinor, currency)!, 0));
  });

  const accountingFormat = (currency: string) => {
    const decimals = definition(currency).decimalPlaces;
    const digits = decimals === 0 ? "" : `.${"0".repeat(decimals)}`;
    return `#,##0${digits};(#,##0${digits});-`;
  };
  currencies.forEach((currency, index) => {
    const differenceRow = 5 + recordChecks.length + index;
    const firstLedgerRow = 5 + recordChecks.length + currencies.length + index * 2;
    for (const row of [differenceRow, firstLedgerRow, firstLedgerRow + 1]) {
      checksSheet.getCell(row, 2).numFmt = accountingFormat(currency);
    }
  });
  const headerColumn = (sheet: ExcelJS.Worksheet, label: string) => {
    const cells = sheet.getRow(4).values as CellValue[];
    const index = cells.indexOf(label);
    return index > 0 ? index : null;
  };
  const moneyColumns = (sheetKey: SheetKey, labelsToFormat: string[]) => {
    const sheet = sheets.get(sheetKey)!;
    const currencyColumn = headerColumn(sheet, labels.columns.currency);
    if (currencyColumn === null) return;
    const columns = labelsToFormat.map((label) => headerColumn(sheet, label)).filter((value): value is number => value !== null);
    for (let row = 5; row <= sheet.rowCount; row++) {
      const currency = String(sheet.getCell(row, currencyColumn).value ?? "");
      if (!currency) continue;
      for (const column of columns) sheet.getCell(row, column).numFmt = accountingFormat(currency);
    }
  };
  moneyColumns("reconciliation", [labels.columns.openingBalance, labels.columns.inflow, labels.columns.outflow,
    labels.columns.calculatedClosing, labels.columns.appClosing, labels.columns.difference]);
  moneyColumns("monthlyActivity", [labels.columns.operatingIncome, labels.columns.operatingExpense, labels.columns.loanIn,
    labels.columns.loanOut, labels.columns.transferIn, labels.columns.transferOut, labels.columns.inflow, labels.columns.outflow,
    labels.columns.netActivity]);
  moneyColumns("walletLedger", [labels.columns.inflow, labels.columns.outflow]);
  moneyColumns("budgetActual", [labels.columns.budget, labels.columns.actual, labels.columns.variance]);
  moneyColumns("transactions", [labels.columns.amount]);
  const transactionSheet = sheets.get("transactions")!;
  const destinationCurrencyColumn = headerColumn(transactionSheet, `${labels.columns.transferIn} ${labels.columns.currency}`);
  const destinationAmountColumn = headerColumn(transactionSheet, `${labels.columns.transferIn} ${labels.columns.amount}`);
  if (destinationCurrencyColumn !== null && destinationAmountColumn !== null) {
    for (let row = 5; row <= transactionSheet.rowCount; row++) {
      if (!transactionSheet.getCell(row, destinationCurrencyColumn).value) continue;
      transactionSheet.getCell(row, destinationAmountColumn).numFmt = accountingFormat(
        String(transactionSheet.getCell(row, destinationCurrencyColumn).value ?? ""),
      );
    }
  }
  moneyColumns("expenseItems", [labels.columns.amount]);
  moneyColumns("balances", [labels.columns.openingBalance, labels.columns.appClosing]);
  moneyColumns("salary", [labels.columns.amount]);
  moneyColumns("fixedExpenses", [labels.columns.amount]);
  moneyColumns("installments", [labels.columns.total, labels.columns.paidBefore, labels.columns.paid, labels.columns.remaining, labels.columns.monthlyPayment]);
  moneyColumns("installmentPayments", [labels.columns.amount]);
  moneyColumns("loans", [labels.columns.principal, labels.columns.fee, labels.columns.totalDue, labels.columns.paid, labels.columns.remaining]);
  moneyColumns("loanPayments", [labels.columns.amount, labels.columns.principal, labels.columns.fee]);
  moneyColumns("receivables", [labels.columns.total, labels.columns.received, labels.columns.remaining]);
  moneyColumns("receipts", [labels.columns.amount]);

  for (let row = 5; row < 5 + currencies.length; row++) {
    const numFmt = accountingFormat(String(summary.getCell(row, 1).value));
    for (let column = 2; column <= 11; column++) summary.getCell(row, column).numFmt = numFmt;
  }
  const budgetPercentColumn = headerColumn(sheets.get("budgetActual")!, labels.columns.variancePercent);
  if (budgetPercentColumn !== null) sheets.get("budgetActual")!.getColumn(budgetPercentColumn).numFmt = "0.0%;(0.0%);-";
  const feeRateColumn = headerColumn(sheets.get("loans")!, labels.columns.feeRate);
  if (feeRateColumn !== null) sheets.get("loans")!.getColumn(feeRateColumn).numFmt = "0.0%;(0.0%);-";

  const dateHeaders = new Set([labels.columns.date, labels.columns.openedOn, labels.columns.dueDate]);
  for (const sheet of workbook.worksheets) {
    for (let column = 1; column <= sheet.columnCount; column++) {
      const heading = String(sheet.getCell(4, column).value ?? "");
      if (dateHeaders.has(heading)) sheet.getColumn(column).numFmt = "dd-mmm-yyyy";
      if (heading === labels.columns.month) sheet.getColumn(column).numFmt = "mmm-yy";
    }
  }
  cover.getCell("B5").numFmt = "dd-mmm-yyyy hh:mm";
  cover.getCell("B6").numFmt = "dd-mmm-yyyy";

  applyExportWorkbookStyle(workbook, data.locale);
  if (schedules.reconciliations.length > 0) {
    reconciliationSheet.addConditionalFormatting({
      ref: `J5:J${4 + schedules.reconciliations.length}`,
      rules: [{
        type: "expression", priority: 1, formulae: ["J5<>0"],
        style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF4B2633" }, bgColor: { argb: "FF4B2633" } },
          font: { color: { argb: "FFFFB4B4" }, bold: true } },
      }],
    });
  }

  for (const [key, sheet] of sheets) if (!kept.has(key)) workbook.removeWorksheet(sheet.id);
  return workbook;
}

export function buildWorkbook(data: ExportData, options: ExportOptions = DEFAULT_DETAILED): ExcelJS.Workbook {
  return options.mode === "simple" ? buildSimpleWorkbook(data, options) : buildExportWorkbook(data, options.sections);
}

export async function writeExportWorkbook(data: ExportData, options: ExportOptions = DEFAULT_DETAILED): Promise<Buffer> {
  const buffer = await buildWorkbook(data, options).xlsx.writeBuffer();
  return Buffer.from(buffer);
}
