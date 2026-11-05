import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  getCurrencies: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/demo-data", () => ({ DEMO_WALLET_CONTAINERS: [
  { id: "demo-active", deleted: false, needsAttention: false },
  { id: "demo-attention", deleted: false, needsAttention: true },
  { id: "demo-deleted", deleted: true, needsAttention: false },
] }));
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
  totals = [
    { balance_id: "balance-usd", wallet_id: "wallet-active", currency: "USD", balance_minor: "125" },
    { balance_id: "balance-eur", wallet_id: "wallet-active", currency: "EUR", balance_minor: "180" },
    { balance_id: "balance-card", wallet_id: "wallet-attention", currency: "USD", balance_minor: "-20" },
    { balance_id: "balance-closed", wallet_id: "wallet-deleted", currency: "USD", balance_minor: "0" },
  ];
  results = {
    wallets: { data: wallets, error: null },
    wallet_balances: { data: balances, error: null },
    wallet_balance_totals: { data: totals, error: null },
  };
  mocks.from.mockImplementation((table: string) => query(() => results[table]));
  mocks.createClient.mockResolvedValue({ from: mocks.from });
});

describe("getWallets", () => {
  it("returns active containers with the exact default first and stable balance order", async () => {
    expect(await getWallets()).toEqual([{
      id: "wallet-active", name: "Pocket", kind: "cash", position: 1, deleted: false, needsAttention: false,
      defaultBalanceId: "balance-eur",
      balances: [
        { id: "balance-eur", walletId: "wallet-active", currency: "EUR", openingBalanceMinor: 200, balanceMinor: 180, position: 1, detached: false },
        { id: "balance-usd", walletId: "wallet-active", currency: "USD", openingBalanceMinor: 100, balanceMinor: 125, position: 0, detached: false },
      ],
    }]);
  });

  it("includes Needs attention and deleted wallets only when explicitly requested", async () => {
    expect((await getWallets({ includeNeedsAttention: true })).map((wallet) => wallet.id)).toEqual(["wallet-active", "wallet-attention"]);
    expect((await getWallets({ includeDeleted: true, includeNeedsAttention: true })).map((wallet) => wallet.id))
      .toEqual(["wallet-active", "wallet-attention", "wallet-deleted"]);
  });

  it("fails when a balance references a missing runtime definition", async () => {
    mocks.getCurrencies.mockResolvedValue([{ code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true }]);
    await expect(getWallets()).rejects.toThrow("Missing currency definition: EUR");
  });

  it("rejects an active wallet whose stored default currency is disabled", async () => {
    mocks.getCurrencies.mockResolvedValue([
      { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true },
      { code: "EUR", symbol: "€", decimalPlaces: 2, disabled: true, firstUsed: false },
    ]);
    await expect(getWallets()).rejects.toThrow("Invalid wallet data");
  });

  it("fails when a balance total is missing instead of substituting its opening amount", async () => {
    totals.splice(1, 1);
    await expect(getWallets()).rejects.toThrow("Wallet balance total unavailable");
  });

  it("rejects malformed money before Number conversion", async () => {
    totals[1].balance_minor = "9007199254740993";
    await expect(getWallets()).rejects.toThrow(MoneyRangeError);
  });

  it("rejects duplicate currencies, cross-wallet totals, and invalid defaults", async () => {
    balances[1].currency = "USD";
    totals[1].currency = "USD";
    await expect(getWallets()).rejects.toThrow("Invalid wallet data");
    balances[1].currency = "EUR";
    totals[1].currency = "EUR";
    totals[1].wallet_id = "wallet-attention";
    await expect(getWallets()).rejects.toThrow("Wallet balance total unavailable");
    totals[1].wallet_id = "wallet-active";
    wallets[0].default_balance_id = "missing";
    await expect(getWallets()).rejects.toThrow("Invalid wallet data");
  });

  it("uses the same active-only default and independent visibility options for demo containers", async () => {
    mocks.configured.mockReturnValue(false);
    expect((await getWallets()).map((wallet) => wallet.id)).toEqual(["demo-active"]);
    expect((await getWallets({ includeNeedsAttention: true })).map((wallet) => wallet.id))
      .toEqual(["demo-active", "demo-attention"]);
    expect((await getWallets({ includeDeleted: true })).map((wallet) => wallet.id))
      .toEqual(["demo-active", "demo-deleted"]);
    expect((await getWallets({ includeDeleted: true, includeNeedsAttention: true })).map((wallet) => wallet.id))
      .toEqual(["demo-active", "demo-attention", "demo-deleted"]);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("surfaces failed table reads without partial data", async () => {
    results.wallet_balance_totals = { data: null, error: { message: "private details" } };
    await expect(getWallets()).rejects.toThrow("Wallet balances unavailable");
  });
});

describe("getLegacyWallets", () => {
  it("adapts only the exact stored built-in default without combining balances", async () => {
    wallets[0].default_balance_id = "balance-usd";
    await expect(getLegacyWallets()).resolves.toEqual([expect.objectContaining({
      id: "wallet-active", currency: "USD", openingBalanceMinor: 100, balanceMinor: 125,
    })]);
  });

  it("fails visibly when an old screen encounters a custom default", async () => {
    wallets[0].default_balance_id = "balance-eur";
    await expect(getLegacyWallets()).rejects.toThrow("Legacy wallet currency unavailable");
  });
});
