import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "@/features/transactions/schema";
import { emptyTransactionMetadata } from "@/features/transactions/schema";
import type { ExportSourceReaders } from "./data";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
import { singleBalanceWallets } from "./test-fixtures";
import { DEMO_WALLET_CONTAINERS } from "@/lib/demo-data";

const state = vi.hoisted(() => ({ configured: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: () => state.configured }));

import { collectConsistentExportData, collectExportData, getExportData, readAllRowsById } from "./data";

describe("readAllRowsById", () => {
  it("reads every row across more than one thousand records using a stable id cursor", async () => {
    const source = Array.from({ length: 1_205 }, (_, index) => ({
      id: `row-${String(index).padStart(4, "0")}`,
      value: index,
    }));
    const rows = await readAllRowsById(async (afterId, limit) => {
      const start = afterId === null ? 0 : source.findIndex((row) => row.id === afterId) + 1;
      return { data: source.slice(start, start + limit), error: null };
    });
    expect(rows).toHaveLength(1_205);
    expect(rows[0]).toEqual({ id: "row-0000", value: 0 });
    expect(rows[1_204]).toEqual({ id: "row-1204", value: 1_204 });
  });

  it("fails closed when a page repeats an id", async () => {
    const pages = [
      [{ id: "a" }, { id: "b" }],
      [{ id: "b" }, { id: "c" }],
    ];
    let page = 0;
    await expect(readAllRowsById(async () => ({ data: pages[page++] ?? [], error: null }), 2))
      .rejects.toThrow("export_data_unavailable");
  });

  it("fails closed when a page query reports an error", async () => {
    await expect(readAllRowsById(async () => ({ data: null, error: new Error("database unavailable") })))
      .rejects.toThrow("export_data_unavailable");
  });
});

function sourceTransaction(): Transaction {
  return {
    ...emptyTransactionMetadata(), id: "txn", kind: "income", occurredOn: "2026-11-01", amountMinor: 1_000,
    currency: "USD", balanceId: "wallet", categoryId: "category", toBalanceId: null, toAmountMinor: null,
    note: "Receipt", createdAt: "2026-11-01T10:00:00Z",
  };
}

function readers(overrides: Partial<ExportSourceReaders> = {}): ExportSourceReaders {
  const profile = { locale: "en" as const, digits: "latin" as const, theme: "light" as const, timezone: "Asia/Beirut", onboarded: true, usdLbpRate: null, salary: null };
  return {
    getProfile: async () => profile,
    getCurrencies: async () => [...SEED_CURRENCY_DEFINITIONS],
    getWallets: async () => singleBalanceWallets([{ id: "wallet", name: "Archived wallet", kind: "cash", currency: "USD", openingBalanceMinor: 0, balanceMinor: 1_000, position: 1, archived: true }]),
    getCategories: async () => [{ id: "category", kind: "income", nameEn: "Consulting", nameAr: "استشارات", tile: 1, color: "teal", position: 1, parentId: null, archivedAt: "2026-01-01T00:00:00Z" }],
    getTransactions: async () => [sourceTransaction()],
    getBudgetRevisions: async () => [{ id: "budget", categoryId: "category", currency: "USD", startsMonth: "2026-11-01", limitMinor: 1_000 }],
    getFixedExpenses: async () => [{ id: "fixed", name: "Rent", amountMinor: 500, balanceId: "wallet", categoryId: "category", dueDay: 1, paidOn: null }],
    getInstallments: async () => [{ id: "installment", name: "Computer", currency: "USD", balanceId: "wallet", categoryId: "category", totalMinor: 2_000,
      paidBeforeMinor: 0, monthlyMinor: 500, dueDay: 10, paidMinor: 0, remainingMinor: 2_000, salaryCycleId: null,
      paidThisCycleMinor: 0, cyclePaymentCount: 0, cycleLatestPaymentId: null, cycleStatus: "unpaid", payments: [], historyComplete: true }],
    getLoans: async () => [
      { id: "loan-live", name: "Live loan", direction: "borrowed", currency: "USD", balanceId: "wallet", feeCategoryId: "category", openedOn: "2026-01-01",
        creationMode: "existing", principalMinor: 1_000, feeBps: 0, feeMinor: 0, totalDueMinor: 1_000, principalPaidBeforeMinor: 0, feePaidBeforeMinor: 0,
        principalPaidMinor: 0, feePaidMinor: 0, principalRemainingMinor: 1_000, feeRemainingMinor: 0, remainingMinor: 1_000, monthlyPaymentMinor: null,
        paymentCount: null, finalPaymentMinor: null, archivedAt: null, deletedAt: null, events: [] },
      { id: "loan-deleted", name: "Deleted loan", direction: "borrowed", currency: "USD", balanceId: "wallet", feeCategoryId: "category", openedOn: "2026-01-01",
        creationMode: "existing", principalMinor: 1_000, feeBps: 0, feeMinor: 0, totalDueMinor: 1_000, principalPaidBeforeMinor: 0, feePaidBeforeMinor: 0,
        principalPaidMinor: 0, feePaidMinor: 0, principalRemainingMinor: 1_000, feeRemainingMinor: 0, remainingMinor: 1_000, monthlyPaymentMinor: null,
        paymentCount: null, finalPaymentMinor: null, archivedAt: null, deletedAt: "2026-10-01T00:00:00Z", events: [] },
    ],
    getPendingPayments: async () => [{ id: "pending", client: "Client", project: "Project", currency: "USD", totalMinor: 2_000,
      receivedMinor: 1_000, remainingMinor: 1_000, dueOn: null, revision: 1, hasReceiptHistory: true }],
    getPendingReceipts: async () => [{ id: "receipt", paymentId: "pending", amountMinor: 1_000, occurredOn: "2026-11-01", balanceId: "wallet", categoryId: "category" }],
    ...overrides,
  };
}

describe("export snapshot", () => {
  it("collects all accountant schedules and excludes deleted source rows", async () => {
    const data = await collectExportData("en", new Date("2026-11-05T08:00:00Z"), readers());
    expect(data.transactions).toHaveLength(1);
    expect(data.budgetRevisions).toHaveLength(1);
    expect(data.fixedExpenses).toHaveLength(1);
    expect(data.installments).toHaveLength(1);
    expect(data.loans.map((loan) => loan.id)).toEqual(["loan-live"]);
    expect(data.pendingPayments).toHaveLength(1);
    expect(data.pendingReceipts).toHaveLength(1);
  });

  it("includes archived master data and preserves the selected locale", async () => {
    const data = await collectExportData("ar", new Date("2026-11-05T08:00:00Z"), readers());
    expect(data.locale).toBe("ar");
    expect(data.wallets[0]).toMatchObject({ id: "wallet", deleted: true });
    expect(data.categories[0]).toMatchObject({ id: "category", archivedAt: "2026-01-01T00:00:00Z" });
  });

  it("builds a complete demo snapshot when Supabase is not configured", async () => {
    state.configured = false;
    const data = await getExportData("ar", new Date("2026-11-05T08:00:00Z"));
    expect(data.locale).toBe("ar");
    expect(data.wallets.length).toBeGreaterThan(0);
    expect(data.categories.length).toBeGreaterThan(0);
    expect(data.transactions.length).toBeGreaterThan(0);
    expect(data.fixedExpenses.length).toBeGreaterThan(0);
    expect(data.installments.length).toBeGreaterThan(0);
    expect(data.loans.length).toBeGreaterThan(0);
    expect(data.pendingPayments.length).toBeGreaterThan(0);
    expect(data.pendingReceipts.length).toBeGreaterThan(0);
    expect(data.wallets).toEqual(DEMO_WALLET_CONTAINERS);
  });

  it("fails the whole export when any required source is unavailable", async () => {
    await expect(collectExportData("en", new Date("2026-11-05T08:00:00Z"), readers({
      getWallets: async () => { throw new Error("sensitive database detail"); },
    }))).rejects.toThrow("export_data_unavailable");
  });

  it("retries independently changing reads and returns only two matching complete snapshots", async () => {
    let walletReads = 0;
    const changing = readers({
      getWallets: async () => {
        walletReads++;
        const balanceMinor = walletReads === 1 ? 500 : 1_000;
        return singleBalanceWallets([{ id: "wallet", name: "Wallet", kind: "cash", currency: "USD", openingBalanceMinor: 0,
          balanceMinor, position: 1, archived: false }]);
      },
    });
    const data = await collectConsistentExportData("en", new Date("2026-11-05T08:00:00Z"), changing);
    expect(walletReads).toBe(3);
    expect(data.wallets[0].balances[0].balanceMinor).toBe(1_000);
  });

  it("fails closed when no two complete snapshots match", async () => {
    let walletReads = 0;
    const changing = readers({
      getWallets: async () => singleBalanceWallets([{ id: "wallet", name: "Wallet", kind: "cash", currency: "USD", openingBalanceMinor: 0,
        balanceMinor: ++walletReads, position: 1, archived: false }]),
    });
    await expect(collectConsistentExportData("en", new Date("2026-11-05T08:00:00Z"), changing))
      .rejects.toThrow("export_data_unavailable");
  });
});


describe("complete runtime export source contract", () => {
  it("collects ordered definitions, exact nondefault custom history and independent empty tombstones", async () => {
    const original = readers();
    const catalog = [
      { code: "TOK", symbol: "🪙ت", decimalPlaces: 8, disabled: true, firstUsed: true },
      ...SEED_CURRENCY_DEFINITIONS.map((row) => ({ ...row, decimalPlaces: row.code === "USD" ? 3 : row.decimalPlaces })),
    ];
    const data = await collectExportData("en", new Date("2026-11-05T08:00:00Z"), readers({
      getCurrencies: async () => catalog,
      getWallets: async () => [
        { id: "container", name: "Closed", kind: "cash", position: 0, deleted: true, needsAttention: false, defaultBalanceId: "usd", balances: [
          { id: "usd", walletId: "container", currency: "USD", openingBalanceMinor: 0, balanceMinor: 0, position: 0, detached: false },
          { id: "wallet", walletId: "container", currency: "TOK", openingBalanceMinor: 123456789, balanceMinor: 123457789, position: 1, detached: true },
        ] },
        { id: "empty", name: "Empty", kind: "bank", position: 1, deleted: true, needsAttention: false, defaultBalanceId: null, balances: [] },
      ],
      getTransactions: async () => [{ ...sourceTransaction(), currency: "TOK" }],
      getBudgetRevisions: async () => (await original.getBudgetRevisions("2026-11-05")).map((row) => ({ ...row, currency: "TOK" })),
      getInstallments: async () => (await original.getInstallments("UTC")).map((row) => ({ ...row, currency: "TOK" })),
      getLoans: async () => (await original.getLoans()).map((row) => ({ ...row, currency: "TOK" })),
      getPendingPayments: async () => (await original.getPendingPayments()).map((row) => ({ ...row, currency: "TOK" })),
    }));
    expect(data.currencies).toEqual(catalog);
    expect(data.wallets.map((row) => row.id)).toEqual(["container", "empty"]);
    expect(data.wallets[0].balances[1]).toMatchObject({ id: "wallet", currency: "TOK", openingBalanceMinor: 123456789, balanceMinor: 123457789 });
    expect(data.fixedExpenses[0].balanceId).toBe("wallet");
  });

  it("fails collection when an exact historical balance is missing even if its wallet default exists", async () => {
    await expect(collectExportData("en", new Date("2026-11-05T08:00:00Z"), readers({
      getFixedExpenses: async () => [{ id: "fixed", name: "Rent", balanceId: "missing", amountMinor: 100, categoryId: "category", dueDay: null, paidOn: null }],
    }))).rejects.toThrow("export_data_unavailable");
  });
});
it("requires the catalog presentation order to stabilize across complete snapshots", async () => {
  let reads = 0;
  await expect(collectConsistentExportData("en", new Date("2026-11-05T08:00:00Z"), readers({
    getCurrencies: async () => ++reads % 2 ? [...SEED_CURRENCY_DEFINITIONS] : [...SEED_CURRENCY_DEFINITIONS].reverse(),
  }))).rejects.toThrow("export_data_unavailable");
});
