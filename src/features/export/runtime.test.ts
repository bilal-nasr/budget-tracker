import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { emptyTransactionMetadata } from "@/features/transactions/schema";
import type { ExportData } from "./model";
vi.mock("server-only", () => ({}));
import { buildExportWorkbook, writeExportWorkbook } from "./workbook";

function source(): ExportData {
  return {
    locale: "en", timezone: "UTC", exportedAt: new Date("2026-11-05T08:00:00Z"), cutoffDate: "2026-11-05",
    profile: { locale: "en", digits: "latin", theme: "light", timezone: "UTC", onboarded: true, usdLbpRate: null, salary: null },
    currencies: [
      { code: "TOK", symbol: "🪙ت", decimalPlaces: 8, disabled: true, firstUsed: true },
      { code: "USD", symbol: "＄", decimalPlaces: 3, disabled: false, firstUsed: true },
      { code: "ZERO", symbol: "零", decimalPlaces: 0, disabled: false, firstUsed: false },
    ],
    wallets: [
      { id: "deleted", name: "Old wallet", kind: "cash", position: 0, deleted: true, needsAttention: false, defaultBalanceId: "usd-default", balances: [
        { id: "usd-default", walletId: "deleted", currency: "USD", openingBalanceMinor: 0, balanceMinor: 0, position: 0, detached: false },
        { id: "tok-history", walletId: "deleted", currency: "TOK", openingBalanceMinor: 999999999999999, balanceMinor: 999999876543210, position: 1, detached: true },
      ] },
      { id: "empty", name: "Empty tombstone", kind: "bank", position: 1, deleted: true, needsAttention: false, defaultBalanceId: null, balances: [] },
      { id: "attention", name: "Needs attention", kind: "card", position: 2, deleted: false, needsAttention: true, defaultBalanceId: "attention-usd", balances: [
        { id: "attention-usd", walletId: "attention", currency: "USD", openingBalanceMinor: 0, balanceMinor: 0, position: 0, detached: false },
      ] },
    ],
    categories: [], transactions: [{ ...emptyTransactionMetadata(), id: "expense", kind: "expense", occurredOn: "2026-11-01", createdAt: "2026-11-01T01:00:00Z", amountMinor: 123456789, currency: "TOK", balanceId: "tok-history", walletNameSnapshot: "Name at payment", categoryId: null, toBalanceId: null, toAmountMinor: null, note: null }],
    budgetRevisions: [], fixedExpenses: [], installments: [], loans: [], pendingPayments: [], pendingReceipts: [],
  };
}
function value(sheet: ExcelJS.Worksheet, row: number, heading: string) {
  const index = (sheet.getRow(4).values as unknown[]).indexOf(heading);
  expect(index).toBeGreaterThan(0);
  return sheet.getCell(row, index);
}

describe("runtime catalog export", () => {
  it("round trips custom eight-decimal numeric values, Unicode symbols, changed built-in precision and complete catalog order", async () => {
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await writeExportWorkbook(source()) as unknown as Parameters<typeof loaded.xlsx.load>[0]);
    const catalog = loaded.getWorksheet("Currency Catalog")!;
    expect(catalog).toBeDefined();
    expect([5, 6, 7].map((row) => value(catalog, row, "Currency").value)).toEqual(["TOK", "USD", "ZERO"]);
    expect(value(catalog, 5, "Symbol").value).toBe("🪙ت");
    expect(value(catalog, 5, "Disabled").value).toBe("Yes");
    const transactions = loaded.getWorksheet("Transactions")!;
    expect(value(transactions, 5, "Amount").value).toBe(1.23456789);
    expect(value(transactions, 5, "Amount").numFmt).toBe("#,##0.00000000;(#,##0.00000000);-");
    const balances = loaded.getWorksheet("Balances")!;
    const usdRow = [5, 6, 7].find((row) => value(balances, row, "Balance ID").value === "usd-default")!;
    expect(value(balances, usdRow, "App closing balance").numFmt).toBe("#,##0.000;(#,##0.000);-");
  });

  it("keeps container tombstones including empty containers independent from exact nondefault historical balances", () => {
    const workbook = buildExportWorkbook(source());
    const wallets = workbook.getWorksheet("Wallets")!;
    expect([5, 6, 7].map((row) => value(wallets, row, "Wallet ID").value)).toEqual(["deleted", "empty", "attention"]);
    expect(value(wallets, 5, "Default balance ID").value).toBe("usd-default");
    expect(value(wallets, 7, "Needs attention").value).toBe("Yes");
    expect(wallets.getRow(4).values).not.toContain("App closing balance");
    const ledger = workbook.getWorksheet("Wallet Ledger")!;
    expect(value(ledger, 5, "Balance ID").value).toBe("tok-history");
    expect(value(ledger, 5, "Wallet ID").value).toBe("deleted");
    const transactions = workbook.getWorksheet("Transactions")!;
    expect(value(transactions, 5, "Wallet name snapshot").value).toBe("Name at payment");
    const balances = workbook.getWorksheet("Balances")!;
    const tokRow = [5, 6, 7].find((row) => value(balances, row, "Balance ID").value === "tok-history")!;
    expect(value(balances, tokRow, "Opening balance (minor units, exact)").value).toBe("999999999999999");
    expect(value(balances, tokRow, "App closing balance (minor units, exact)").value).toBe("999999876543210");
  });

  it("keeps summary and control totals in catalog order with no cross-currency total or automatic conversion", () => {
    const workbook = buildExportWorkbook(source());
    const summary = workbook.getWorksheet("Financial Summary")!;
    expect([5, 6, 7].map((row) => summary.getCell(row, 1).value)).toEqual(["TOK", "USD", "ZERO"]);
    expect(summary.getCell("A8").value).toBeNull();
    for (let row = 5; row <= 7; row++) {
      const formula = summary.getCell(row, 2).value as { formula: string };
      expect(formula.formula).toContain(`$A${row}`);
    }
    expect(workbook.getWorksheet("Checks & Definitions")!.getColumn(1).values).toContain("Wallet reconciliation difference - TOK");
  });

  it.each(["currency", "balance", "ownership", "default"])("fails closed on a missing or invalid %s reference without guessing a denomination", (missing) => {
    const data = source();
    if (missing === "currency") data.currencies = data.currencies.filter((row) => row.code !== "TOK");
    if (missing === "balance") data.transactions = data.transactions.map((row) => ({ ...row, balanceId: "missing" }));
    if (missing === "ownership") data.wallets = data.wallets.map((wallet, i) => i ? wallet : ({ ...wallet, balances: wallet.balances.map((balance) => ({ ...balance, walletId: "other" })) }));
    if (missing === "default") data.wallets = data.wallets.map((wallet, i) => i ? wallet : ({ ...wallet, defaultBalanceId: "absent" }));
    expect(() => buildExportWorkbook(data)).toThrow("export_data_unavailable");
  });
});


  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])("round trips configured precision %i without symbol-dependent formatting", async (precision) => {
    const data = source();
    data.currencies = [{ code: "UNIT", symbol: '🧮"[零]', decimalPlaces: precision, disabled: false, firstUsed: true }];
    data.wallets = [{ id: "container", name: "Precision example", kind: "cash", position: 0, deleted: true, needsAttention: false, defaultBalanceId: "unit", balances: [
      { id: "unit", walletId: "container", currency: "UNIT", openingBalanceMinor: 0, balanceMinor: -123456789, position: 0, detached: false },
    ] }];
    data.transactions = data.transactions.map((row) => ({ ...row, currency: "UNIT", balanceId: "unit" }));
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await writeExportWorkbook(data) as unknown as Parameters<typeof loaded.xlsx.load>[0]);
    const amount = value(loaded.getWorksheet("Transactions")!, 5, "Amount");
    const digits = precision ? `.${"0".repeat(precision)}` : "";
    expect(amount.value).toBe(123456789 / 10 ** precision);
    expect(amount.numFmt).toBe(`#,##0${digits};(#,##0${digits});-`);
    expect(value(loaded.getWorksheet("Currency Catalog")!, 5, "Symbol").value).toBe('🧮"[零]');
    const exact = loaded.getWorksheet("Source & Exact Facts")!;
    const path = exact.getColumn(1).values.indexOf("source/transactions/expense/amountMinor");
    expect(exact.getCell(path, 2).value).toBe("UNIT");
    expect(exact.getCell(path, 3).value).toBe("123456789");
  });

  it("retains both exact legs for a same-container exchange and historical name snapshots", async () => {
    const data = source();
    data.transactions = data.transactions.map((row) => ({ ...row, kind: "transfer", toBalanceId: "usd-default", toAmountMinor: 1234, toWalletNameSnapshot: "Destination at payment" }));
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await writeExportWorkbook(data) as unknown as Parameters<typeof loaded.xlsx.load>[0]);
    const exact = loaded.getWorksheet("Source & Exact Facts")!;
    const received = exact.getColumn(1).values.indexOf("source/transactions/expense/toAmountMinor");
    expect(exact.getCell(received, 2).value).toBe("USD");
    expect(exact.getCell(received, 3).value).toBe("1234");
    const ledger = loaded.getWorksheet("Wallet Ledger")!;
    expect([5, 6].map((row) => value(ledger, row, "Balance ID").value)).toEqual(["tok-history", "usd-default"]);
    expect([5, 6].map((row) => value(ledger, row, "Wallet ID").value)).toEqual(["deleted", "deleted"]);
    const transactions = loaded.getWorksheet("Transactions")!;
    expect(value(transactions, 5, "Transfers in Balance ID").value).toBe("usd-default");
    expect(value(transactions, 5, "Transfers in Amount").value).toBe(1.234);
    expect(value(transactions, 5, "Destination wallet name snapshot").value).toBe("Destination at payment");
  });

  it("retains exact settlement legs and rate snapshots as text with each original denomination", async () => {
    const data = source();
    data.transactions = data.transactions.map((row) => ({ ...row, currency: "USD", amountMinor: 1234, settlement: {
      tenderCurrency: "TOK", tenderMinor: 123456789,
      changes: [{ balanceId: "attention-usd", currency: "USD", amountMinor: 10, walletNameSnapshot: "Receiver at payment",
        rate: { base: "TOK", quote: "USD", quoteMajorNumerator: 100000000, quoteMajorDenominator: 123456789 } }],
    } }));
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await writeExportWorkbook(data) as unknown as Parameters<typeof loaded.xlsx.load>[0]);
    const facts = loaded.getWorksheet("Source & Exact Facts")!;
    const exact = (path: string) => {
      const row = facts.getColumn(1).values.indexOf(`source/transactions/expense/${path}`);
      expect(row).toBeGreaterThan(0);
      return [facts.getCell(row, 2).value, facts.getCell(row, 3).value];
    };
    expect(exact("amountMinor")).toEqual(["USD", "1234"]);
    expect(exact("settlement/tenderMinor")).toEqual(["TOK", "123456789"]);
    expect(exact("settlement/changes/0/balanceId")).toEqual(["USD", "attention-usd"]);
    expect(exact("settlement/changes/0/walletNameSnapshot")).toEqual(["USD", "Receiver at payment"]);
    expect(exact("settlement/changes/0/rate/quoteMajorDenominator")).toEqual(["USD", "123456789"]);
    const balances = loaded.getWorksheet("Balances")!;
    const history = [5, 6, 7].find((row) => value(balances, row, "Balance ID").value === "tok-history")!;
    expect(value(balances, history, "Opening balance (minor units, exact)").value).toBe("999999999999999");
    expect(value(balances, history, "App closing balance (minor units, exact)").value).toBe("999999876543210");
  });
describe("monetary check precision", () => {
  it.each([
    { precision: 0, difference: -1, inflow: 1, outflow: 2, format: "#,##0;(#,##0);-" },
    { precision: 1, difference: -0.1, inflow: 0.1, outflow: 0.2, format: "#,##0.0;(#,##0.0);-" },
    { precision: 2, difference: -0.01, inflow: 0.01, outflow: 0.02, format: "#,##0.00;(#,##0.00);-" },
    { precision: 3, difference: -0.001, inflow: 0.001, outflow: 0.002, format: "#,##0.000;(#,##0.000);-" },
    { precision: 4, difference: -0.0001, inflow: 0.0001, outflow: 0.0002, format: "#,##0.0000;(#,##0.0000);-" },
    { precision: 5, difference: -0.00001, inflow: 0.00001, outflow: 0.00002, format: "#,##0.00000;(#,##0.00000);-" },
    { precision: 6, difference: -0.000001, inflow: 0.000001, outflow: 0.000002, format: "#,##0.000000;(#,##0.000000);-" },
    { precision: 7, difference: -0.0000001, inflow: 0.0000001, outflow: 0.0000002, format: "#,##0.0000000;(#,##0.0000000);-" },
    { precision: 8, difference: -0.00000001, inflow: 0.00000001, outflow: 0.00000002, format: "#,##0.00000000;(#,##0.00000000);-" },
  ])("round trips precision $precision difference/inflow/outflow controls while leaving counts as counts", async ({ precision, difference, inflow, outflow, format }) => {
    const data = source();
    data.currencies = [{ code: "UNIT", symbol: "◈", decimalPlaces: precision, disabled: false, firstUsed: true }];
    data.wallets = [{ id: "container", name: "Check example", kind: "cash", position: 0, deleted: false, needsAttention: false, defaultBalanceId: "unit", balances: [
      { id: "unit", walletId: "container", currency: "UNIT", openingBalanceMinor: 0, balanceMinor: 0, position: 0, detached: false },
    ] }];
    data.transactions = [
      { ...data.transactions[0], id: "income", kind: "income", amountMinor: 1, currency: "UNIT", balanceId: "unit" },
      { ...data.transactions[0], id: "expense", amountMinor: 2, currency: "UNIT", balanceId: "unit" },
    ];
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await writeExportWorkbook(data) as unknown as Parameters<typeof loaded.xlsx.load>[0]);
    const checks = loaded.getWorksheet("Checks & Definitions")!;
    const check = (metric: string) => {
      const row = checks.getColumn(1).values.indexOf(metric);
      expect(row).toBeGreaterThan(0);
      return checks.getCell(row, 2);
    };
    for (const [metric, expected] of [
      ["Wallet reconciliation difference - UNIT", difference],
      ["Wallet Ledger Inflow - UNIT", inflow],
      ["Wallet Ledger Outflow - UNIT", outflow],
    ] as const) {
      const cell = check(metric);
      expect((cell.value as { formula: string; result: number }).formula).toContain('"UNIT"');
      expect((cell.value as { result: number }).result).toBe(expected);
      expect(cell.numFmt).toBe(format);
    }
    const count = check("Transactions - records");
    expect(count.value).toBe(2);
    expect(count.numFmt ?? "General").toBe("General");
  });
});
