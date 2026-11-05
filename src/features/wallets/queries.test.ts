import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  getCurrencies: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/demo-data", () => ({ get DEMO_WALLET_CONTAINERS() { return demoContainers; } }));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: mocks.getCurrencies }));

import { getLegacyWallets, getWallets } from "./queries";
import { MoneyRangeError } from "@/lib/money";

type Result = { data: unknown[] | null; error: { message: string } | null };

function query(result: () => Result) {
  const value: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order"]) value[method] = vi.fn().mockReturnValue(value);
  value.then = (resolve: (result: Result) => unknown) => Promise.resolve(result()).then(resolve);
  return value;
}

const wallets = [
  { id: "wallet-active", name: "Pocket", kind: "cash", default_balance_id: "balance-eur", position: 1, deleted_at: null, needs_attention: false, created_at: "2026-01-01" },
  { id: "wallet-attention", name: "Old card", kind: "card", default_balance_id: "balance-card", position: 2, deleted_at: null, needs_attention: true, created_at: "2026-01-02" },
  { id: "wallet-deleted", name: "Closed", kind: "bank", default_balance_id: "balance-closed", position: 3, deleted_at: "2026-02-01", needs_attention: false, created_at: "2026-01-03" },
];

let demoContainers: unknown[];
let balances: Record<string, unknown>[];
let totals: Record<string, unknown>[];
let results: Record<string, Result>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.getCurrencies.mockResolvedValue([
    { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true },
    { code: "EUR", symbol: "€", decimalPlaces: 2, disabled: false, firstUsed: false },
  ]);
  balances = [
    { id: "balance-usd", wallet_id: "wallet-active", currency: "USD", opening_balance_minor: "100", position: 0, detached_at: null, created_at: "2026-01-01" },
    { id: "balance-eur", wallet_id: "wallet-active", currency: "EUR", opening_balance_minor: "200", position: 1, detached_at: null, created_at: "2026-01-02" },
    { id: "balance-card", wallet_id: "wallet-attention", currency: "USD", opening_balance_minor: "0", position: 0, detached_at: null, created_at: "2026-01-03" },
    { id: "balance-closed", wallet_id: "wallet-deleted", currency: "USD", opening_balance_minor: "0", position: 0, detached_at: "2026-02-01", created_at: "2026-01-04" },
  ];
  balances.push({ id: "balance-card-eur", wallet_id: "wallet-attention", currency: "EUR", opening_balance_minor: "0", position: 1, detached_at: null, created_at: "2026-01-03" });
  totals = [
    { balance_id: "balance-usd", wallet_id: "wallet-active", currency: "USD", balance_minor: "125" },
    { balance_id: "balance-eur", wallet_id: "wallet-active", currency: "EUR", balance_minor: "180" },
    { balance_id: "balance-card", wallet_id: "wallet-attention", currency: "USD", balance_minor: "-20" },
    { balance_id: "balance-closed", wallet_id: "wallet-deleted", currency: "USD", balance_minor: "0" },
  ];
  totals.push({ balance_id: "balance-card-eur", wallet_id: "wallet-attention", currency: "EUR", balance_minor: "0" });
  results = {
    wallets: { data: structuredClone(wallets), error: null },
    wallet_balances: { data: balances, error: null },
    wallet_balance_totals: { data: totals, error: null },
  };
  mocks.from.mockImplementation((table: string) => query(() => results[table]));
  mocks.createClient.mockResolvedValue({ from: mocks.from });
});

function syncDemo() {
  demoContainers = results.wallets.data!.map((entry) => {
    const row = entry as typeof wallets[number];
    return {
      id: row.id, name: row.name, kind: row.kind, position: row.position,
      deleted: row.deleted_at !== null, needsAttention: row.needs_attention,
      defaultBalanceId: row.default_balance_id,
      balances: balances.filter((balance) => balance.wallet_id === row.id).map((balance) => ({
        id: balance.id, walletId: balance.wallet_id, currency: balance.currency,
        openingBalanceMinor: Number(balance.opening_balance_minor),
        balanceMinor: Number(totals.find((total) => total.balance_id === balance.id)?.balance_minor),
        position: balance.position, detached: balance.detached_at !== null,
      })),
    };
  });
}

function addDisabledBalance() {
  mocks.getCurrencies.mockResolvedValue([
    { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true },
    { code: "BTC", symbol: "₿", decimalPlaces: 8, disabled: true, firstUsed: true },
    { code: "EUR", symbol: "€", decimalPlaces: 2, disabled: false, firstUsed: false },
  ]);
  balances.unshift({ id: "btc", wallet_id: "wallet-active", currency: "BTC", opening_balance_minor: "0", position: 0, detached_at: "2026-01-01", created_at: "2026-01-01" });
  totals.push({ balance_id: "btc", wallet_id: "wallet-active", currency: "BTC", balance_minor: "0" });
}

describe.each(["database", "demo"])("getWallets %s", (mode) => {
  async function read(options: Parameters<typeof getWallets>[0] = {}) {
    if (mode === "demo") { syncDemo(); mocks.configured.mockReturnValue(false); }
    return getWallets(options);
  }

  it("returns every enabled balance in catalog order regardless of default and local position", async () => {
    balances[0].position = 99;
    expect(await read()).toEqual([{
      id: "wallet-active", name: "Pocket", kind: "cash", position: 1, deleted: false, needsAttention: false,
      defaultBalanceId: "balance-eur",
      balances: [
        { id: "balance-usd", walletId: "wallet-active", currency: "USD", openingBalanceMinor: 100, balanceMinor: 125, position: 99, detached: false },
        { id: "balance-eur", walletId: "wallet-active", currency: "EUR", openingBalanceMinor: 200, balanceMinor: 180, position: 1, detached: false },
      ],
    }]);
    if (mode === "demo") expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("keeps deleted, Needs-attention and disabled visibility independent", async () => {
    addDisabledBalance();
    expect((await read())[0].balances.map((balance) => balance.id)).toEqual(["balance-usd", "balance-eur"]);
    expect((await read({ includeDisabledBalances: true }))[0].balances.map((balance) => balance.id)).toEqual(["balance-usd", "btc", "balance-eur"]);
    expect((await read({ includeNeedsAttention: true })).map((wallet) => wallet.id)).toEqual(["wallet-active", "wallet-attention"]);
    expect((await read({ includeDeleted: true })).map((wallet) => wallet.id)).toEqual(["wallet-active", "wallet-deleted"]);
    expect((await read({ includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true })).map((wallet) => wallet.id))
      .toEqual(["wallet-active", "wallet-attention", "wallet-deleted"]);
  });

  it.each(["wallet-active", "wallet-attention"])("rejects incomplete enabled coverage even on filtered wallet %s", async (walletId) => {
    const index = balances.findIndex((balance) => balance.wallet_id === walletId && balance.currency === "EUR");
    const [removed] = balances.splice(index, 1);
    totals.splice(totals.findIndex((total) => total.balance_id === removed.id), 1);
    await expect(read()).rejects.toThrow("Invalid wallet data");
  });

  it.each(["duplicate currency", "duplicate ID", "cross-wallet default", "detached enabled", "null live default"])("rejects %s", async (change) => {
    if (change === "duplicate currency") { balances[1].currency = "USD"; totals[1].currency = "USD"; }
    if (change === "duplicate ID") { balances[1].id = balances[0].id; }
    if (change === "cross-wallet default") (results.wallets.data![0] as Record<string, unknown>).default_balance_id = "balance-card";
    if (change === "detached enabled") balances[0].detached_at = "2026-01-01";
    if (change === "null live default") (results.wallets.data![0] as Record<string, unknown>).default_balance_id = null;
    await expect(read()).rejects.toThrow();
  });

  it("rejects a disabled live default instead of substituting another balance", async () => {
    mocks.getCurrencies.mockResolvedValue([
      { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true },
      { code: "EUR", symbol: "€", decimalPlaces: 2, disabled: true, firstUsed: false },
    ]);
    await expect(read()).rejects.toThrow("Invalid wallet data");
  });

  it("accepts only empty deleted null-default tombstones without inventing a balance", async () => {
    const deleted = results.wallets.data![2] as Record<string, unknown>;
    deleted.default_balance_id = null;
    await expect(read({ includeDeleted: true })).rejects.toThrow("Invalid wallet data");
    balances.splice(balances.findIndex((balance) => balance.id === "balance-closed"), 1);
    totals.splice(totals.findIndex((total) => total.balance_id === "balance-closed"), 1);
    expect((await read({ includeDeleted: true, includeDisabledBalances: true }))[1]).toEqual({
      id: "wallet-deleted", name: "Closed", kind: "bank", position: 3, deleted: true, needsAttention: false,
      defaultBalanceId: null, balances: [],
    });
  });

  it("preserves a deleted disabled default identity when its balance is hidden", async () => {
    addDisabledBalance();
    balances[balances.findIndex((balance) => balance.id === "balance-closed")].currency = "BTC";
    totals[totals.findIndex((total) => total.balance_id === "balance-closed")].currency = "BTC";
    const hidden = (await read({ includeDeleted: true }))[1];
    expect(hidden.defaultBalanceId).toBe("balance-closed");
    expect(hidden.balances).toEqual([]);
    const full = (await read({ includeDeleted: true, includeDisabledBalances: true }))[1];
    expect(full.balances.map((balance) => balance.id)).toEqual(["balance-closed"]);
  });

  it("fails when a balance references a missing runtime definition", async () => {
    mocks.getCurrencies.mockResolvedValue([{ code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true }]);
    await expect(read()).rejects.toThrow("Missing currency definition: EUR");
  });
});

describe("database integrity", () => {
  it.each(["missing", "duplicate", "cross-wallet", "wrong currency", "extra"])("rejects %s totals", async (change) => {
    if (change === "missing") totals.splice(1, 1);
    if (change === "duplicate") totals.push({ ...totals[0] });
    if (change === "cross-wallet") totals[0].wallet_id = "wallet-attention";
    if (change === "wrong currency") totals[0].currency = "EUR";
    if (change === "extra") totals.push({ ...totals[0], balance_id: "extra" });
    await expect(getWallets()).rejects.toThrow("Wallet balance total unavailable");
  });
  it("rejects malformed money before Number conversion", async () => {
    totals[1].balance_minor = "9007199254740993";
    await expect(getWallets()).rejects.toThrow(MoneyRangeError);
  });
  it("surfaces failed reads without partial data", async () => {
    results.wallet_balance_totals = { data: null, error: { message: "private details" } };
    await expect(getWallets()).rejects.toThrow("Wallet balances unavailable");
  });
});

describe("real demo fixture", () => {
  it("stores every enabled currency in each non-deleted wallet with stable distinct IDs", async () => {
    const { DEMO_WALLET_CONTAINERS, DEMO_CURRENCIES } = await vi.importActual<typeof import("@/lib/demo-data")>("@/lib/demo-data");
    const enabled = DEMO_CURRENCIES.filter((currency) => !currency.disabled).map((currency) => currency.code);
    const ids = new Set<string>();
    for (const wallet of DEMO_WALLET_CONTAINERS.filter((wallet) => !wallet.deleted)) {
      expect(wallet.balances.map((balance) => balance.currency)).toEqual(enabled);
      for (const balance of wallet.balances) {
        expect(ids.has(balance.id)).toBe(false);
        ids.add(balance.id);
        if (balance.id !== wallet.defaultBalanceId && balance.id !== "00000000-0000-4000-8000-000000000003") {
          expect(balance.openingBalanceMinor).toBe(0);
          expect(balance.balanceMinor).toBe(0);
        }
      }
    }
  });
});

describe("getLegacyWallets compatibility", () => {
  it("adapts only the exact stored built-in default without combining balances", async () => {
    (results.wallets.data![0] as Record<string, unknown>).default_balance_id = "balance-usd";
    await expect(getLegacyWallets()).resolves.toEqual([expect.objectContaining({ id: "wallet-active", currency: "USD", openingBalanceMinor: 100, balanceMinor: 125 })]);
  });
  it("fails visibly when an old screen encounters a custom default", async () => {
    await expect(getLegacyWallets()).rejects.toThrow("Legacy wallet currency unavailable");
  });
});
