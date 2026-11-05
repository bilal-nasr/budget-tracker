import { categoryName } from "@/features/categories/schema";
import { CURRENCIES, CURRENCY_DECIMALS, readMinor, sumMinor, type Currency } from "@/lib/money";
import type {
  BudgetActualRow,
  ExportData,
  ExportSchedules,
  MonthlyActivityRow,
  WalletLedgerRow,
  WalletReconciliation,
} from "./model";

export function minorToMajor(minor: number, currency: Currency): number {
  return readMinor(minor) / 10 ** CURRENCY_DECIMALS[currency];
}

function safeTotal(values: readonly number[]): number {
  return sumMinor(values.map(readMinor));
}

export function buildWalletLedger(data: ExportData): WalletLedgerRow[] {
  const wallets = new Map(data.wallets.map((wallet) => [wallet.id, wallet]));
  const categories = new Map(data.categories.map((category) => [category.id, category]));
  const rows: Array<WalletLedgerRow & { legOrder: number }> = [];

  for (const transaction of data.transactions) {
    const addLeg = (
      walletId: string,
      currency: Currency,
      leg: WalletLedgerRow["leg"],
      inflowMinor: number,
      outflowMinor: number,
      legOrder: number,
    ) => {
      const wallet = wallets.get(walletId);
      if (!wallet || wallet.currency !== currency) throw new Error("export_data_unavailable");
      const category = transaction.categoryId ? categories.get(transaction.categoryId) : undefined;
      rows.push({
        rowId: `${transaction.id}:${leg}:${legOrder}`,
        transactionId: transaction.id,
        occurredOn: transaction.occurredOn,
        createdAt: transaction.createdAt,
        walletId,
        walletName: wallet.name,
        currency,
        leg,
        inflowMinor: readMinor(inflowMinor),
        outflowMinor: readMinor(outflowMinor),
        categoryId: transaction.categoryId,
        categoryName: category ? categoryName(category, data.locale) : "",
        note: transaction.note,
        source: transaction.source,
        fixedExpenseId: transaction.fixedExpenseId,
        installmentId: transaction.installmentId,
        loanId: transaction.loanId,
        pendingPaymentId: transaction.pendingPaymentId ?? null,
        legOrder,
      });
    };

    if (transaction.kind === "income") {
      addLeg(transaction.walletId, transaction.currency, "income", transaction.amountMinor, 0, 0);
    } else if (transaction.kind === "expense") {
      addLeg(transaction.walletId, transaction.currency, "expense", 0, transaction.settlement?.tenderMinor ?? transaction.amountMinor, 0);
      transaction.settlement?.changes.forEach((change, index) => {
        addLeg(change.walletId, change.currency, "cash-change", change.amountMinor, 0, index + 1);
      });
    } else if (transaction.kind === "transfer") {
      if (!transaction.toWalletId || transaction.toAmountMinor === null) throw new Error("export_data_unavailable");
      const target = wallets.get(transaction.toWalletId);
      if (!target) throw new Error("export_data_unavailable");
      addLeg(transaction.walletId, transaction.currency, "transfer-out", 0, transaction.amountMinor, 0);
      addLeg(target.id, target.currency, "transfer-in", transaction.toAmountMinor, 0, 1);
    } else if (transaction.kind === "loan") {
      if (transaction.loanFlow === "in") addLeg(transaction.walletId, transaction.currency, "loan-in", transaction.amountMinor, 0, 0);
      else if (transaction.loanFlow === "out") addLeg(transaction.walletId, transaction.currency, "loan-out", 0, transaction.amountMinor, 0);
      else throw new Error("export_data_unavailable");
    }
  }

  return rows.sort((a, b) =>
    a.occurredOn.localeCompare(b.occurredOn) || a.createdAt.localeCompare(b.createdAt) ||
    a.transactionId.localeCompare(b.transactionId) || a.legOrder - b.legOrder,
  ).map(({ legOrder: _legOrder, ...row }) => row);
}

export function buildReconciliations(
  data: ExportData,
  ledger: readonly WalletLedgerRow[],
): WalletReconciliation[] {
  return [...data.wallets].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map((wallet) => {
    const rows = ledger.filter((row) => row.walletId === wallet.id);
    const inflowMinor = safeTotal(rows.map((row) => row.inflowMinor));
    const outflowMinor = safeTotal(rows.map((row) => row.outflowMinor));
    const calculatedClosingMinor = safeTotal([wallet.openingBalanceMinor, inflowMinor, -outflowMinor]);
    const exportedClosingMinor = readMinor(wallet.balanceMinor);
    return {
      walletId: wallet.id,
      walletName: wallet.name,
      currency: wallet.currency,
      archived: wallet.archived,
      openingBalanceMinor: readMinor(wallet.openingBalanceMinor),
      inflowMinor,
      outflowMinor,
      calculatedClosingMinor,
      exportedClosingMinor,
      differenceMinor: safeTotal([calculatedClosingMinor, -exportedClosingMinor]),
    };
  });
}

function addSafe(left: number, right: number): number {
  return safeTotal([left, right]);
}

export function buildMonthlyActivity(data: ExportData): MonthlyActivityRow[] {
  const ledger = buildWalletLedger(data);
  const rows = new Map<string, MonthlyActivityRow>();
  const walletCurrency = new Map(data.wallets.map((wallet) => [wallet.id, wallet.currency]));
  const get = (month: string, currency: Currency) => {
    const key = `${month}|${currency}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        month, currency, operatingIncomeMinor: 0, operatingExpenseMinor: 0,
        loanInMinor: 0, loanOutMinor: 0, transferInMinor: 0, transferOutMinor: 0,
        walletInflowMinor: 0, walletOutflowMinor: 0, netWalletActivityMinor: 0,
      };
      rows.set(key, row);
    }
    return row;
  };

  for (const transaction of data.transactions) {
    const month = transaction.occurredOn.slice(0, 7);
    const row = get(month, transaction.currency);
    if (transaction.kind === "income") row.operatingIncomeMinor = addSafe(row.operatingIncomeMinor, transaction.amountMinor);
    else if (transaction.kind === "expense") row.operatingExpenseMinor = addSafe(row.operatingExpenseMinor, transaction.amountMinor);
    else if (transaction.kind === "loan" && transaction.loanFlow === "in") row.loanInMinor = addSafe(row.loanInMinor, transaction.amountMinor);
    else if (transaction.kind === "loan" && transaction.loanFlow === "out") row.loanOutMinor = addSafe(row.loanOutMinor, transaction.amountMinor);
    else if (transaction.kind === "transfer") {
      row.transferOutMinor = addSafe(row.transferOutMinor, transaction.amountMinor);
      if (!transaction.toWalletId || transaction.toAmountMinor === null) throw new Error("export_data_unavailable");
      const targetCurrency = walletCurrency.get(transaction.toWalletId);
      if (!targetCurrency) throw new Error("export_data_unavailable");
      const target = get(month, targetCurrency);
      target.transferInMinor = addSafe(target.transferInMinor, transaction.toAmountMinor);
    }
  }

  for (const leg of ledger) {
    const row = get(leg.occurredOn.slice(0, 7), leg.currency);
    row.walletInflowMinor = addSafe(row.walletInflowMinor, leg.inflowMinor);
    row.walletOutflowMinor = addSafe(row.walletOutflowMinor, leg.outflowMinor);
  }
  for (const row of rows.values()) {
    row.netWalletActivityMinor = safeTotal([row.walletInflowMinor, -row.walletOutflowMinor]);
  }

  const currencyOrder = new Map(CURRENCIES.map((currency, index) => [currency, index]));
  return [...rows.values()].sort((a, b) =>
    a.month.localeCompare(b.month) || (currencyOrder.get(a.currency) ?? 99) - (currencyOrder.get(b.currency) ?? 99),
  );
}

function monthAfter(month: string): string {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number, 1));
  return date.toISOString().slice(0, 7);
}

export function buildBudgetActuals(data: ExportData): BudgetActualRow[] {
  const categories = new Map(data.categories.map((category) => [category.id, category]));
  const actuals = new Map<string, number>();
  const combinations = new Set<string>();
  const firstMonth = new Map<string, string>();
  const revisions = new Map<string, typeof data.budgetRevisions>();

  for (const transaction of data.transactions) {
    if (transaction.kind !== "expense" || !transaction.categoryId) continue;
    const category = categories.get(transaction.categoryId);
    if (!category) throw new Error("export_data_unavailable");
    const categoryId = category.parentId ?? category.id;
    if (!categories.has(categoryId)) throw new Error("export_data_unavailable");
    const month = transaction.occurredOn.slice(0, 7);
    const combination = `${categoryId}|${transaction.currency}`;
    const key = `${month}|${combination}`;
    combinations.add(combination);
    firstMonth.set(combination, firstMonth.has(combination) && firstMonth.get(combination)! < month ? firstMonth.get(combination)! : month);
    actuals.set(key, addSafe(actuals.get(key) ?? 0, transaction.amountMinor));
  }

  for (const revision of data.budgetRevisions) {
    const combination = `${revision.categoryId}|${revision.currency}`;
    const month = revision.startsMonth.slice(0, 7);
    combinations.add(combination);
    firstMonth.set(combination, firstMonth.has(combination) && firstMonth.get(combination)! < month ? firstMonth.get(combination)! : month);
    const list = revisions.get(combination) ?? [];
    revisions.set(combination, [...list, revision].sort((a, b) => a.startsMonth.localeCompare(b.startsMonth) || a.id.localeCompare(b.id)));
  }

  const cutoffMonth = data.cutoffDate.slice(0, 7);
  const output: BudgetActualRow[] = [];
  for (const combination of combinations) {
    const [categoryId, currencyText] = combination.split("|");
    const currency = currencyText as Currency;
    const category = categories.get(categoryId);
    const start = firstMonth.get(combination);
    if (!category || !CURRENCIES.includes(currency) || !start) throw new Error("export_data_unavailable");
    const history = revisions.get(combination) ?? [];
    for (let month = start; month <= cutoffMonth; month = monthAfter(month)) {
      const effective = [...history].reverse().find((revision) => revision.startsMonth.slice(0, 7) <= month);
      const limitMinor = effective ? (effective.limitMinor === null ? null : readMinor(effective.limitMinor)) : null;
      const actualMinor = actuals.get(`${month}|${combination}`) ?? 0;
      if (limitMinor === null && actualMinor === 0) continue;
      const varianceMinor = limitMinor === null ? null : safeTotal([limitMinor, -actualMinor]);
      const variancePercent = limitMinor === null || limitMinor === 0 ? null : varianceMinor! / limitMinor;
      const status: BudgetActualRow["status"] = limitMinor === null ? "unbudgeted"
        : actualMinor > limitMinor ? "over" : actualMinor < limitMinor ? "under" : "on";
      output.push({
        month, categoryId, categoryName: categoryName(category, data.locale), currency,
        limitMinor, actualMinor, varianceMinor, variancePercent, status,
      });
    }
  }
  const currencyOrder = new Map(CURRENCIES.map((currency, index) => [currency, index]));
  return output.sort((a, b) => a.month.localeCompare(b.month) ||
    (currencyOrder.get(a.currency) ?? 99) - (currencyOrder.get(b.currency) ?? 99) ||
    a.categoryName.localeCompare(b.categoryName) || a.categoryId.localeCompare(b.categoryId));
}

export function buildExportSchedules(data: ExportData): ExportSchedules {
  const walletLedger = buildWalletLedger(data);
  return {
    walletLedger,
    reconciliations: buildReconciliations(data, walletLedger),
    monthlyActivity: buildMonthlyActivity(data),
    budgetActuals: buildBudgetActuals(data),
  };
}
