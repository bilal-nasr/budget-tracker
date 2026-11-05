import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actionClient: vi.fn(), revalidatePath: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/action", async (original) => {
  const actual = await original<typeof import("@/lib/supabase/action")>();
  return { ...actual, actionClient: mocks.actionClient };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { createCurrency, deleteCurrency, inspectCurrencyDisable, setCurrencyEnabled, updateCurrency } from "./actions";

const owner = "aaaaaaaa-0000-4000-8000-000000000001";
let writeResult: { data: unknown; error: null | { code?: string; message?: string } };
let reads: Record<string, { data: unknown[] | null; error: null | { message: string } }>;

function query(table: string) {
  const value: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "delete", "eq", "order"]) value[method] = vi.fn().mockReturnValue(value);
  value.single = vi.fn(() => Promise.resolve(writeResult));
  value.maybeSingle = vi.fn(() => Promise.resolve(writeResult));
  value.then = (resolve: (result: unknown) => unknown) => Promise.resolve(reads[table]).then(resolve);
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  writeResult = { data: { code: "EUR" }, error: null };
  reads = {
    currencies: { data: [{ code: "USD", disabled_at: null }, { code: "EUR", disabled_at: null }], error: null },
    wallets: { data: [{ id: "wallet", name: "Pocket", default_balance_id: "eur", deleted_at: null, needs_attention: false }], error: null },
    wallet_balances: { data: [
      { id: "eur", wallet_id: "wallet", currency: "EUR", detached_at: null },
      { id: "usd", wallet_id: "wallet", currency: "USD", detached_at: null },
    ], error: null },
    wallet_balance_totals: { data: [{ balance_id: "eur", wallet_id: "wallet", currency: "EUR", balance_minor: 0 }], error: null },
    profiles: { data: [{ salary_balance_id: null }], error: null },
    fixed_expenses: { data: [], error: null },
    installments: { data: [], error: null },
    installment_progress: { data: [], error: null },
    loan_progress: { data: [], error: null },
    pending_payment_progress: { data: [], error: null },
    budgets: { data: [], error: null },
  };
  mocks.from.mockImplementation((table: string) => query(table));
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.actionClient.mockResolvedValue({ userId: owner, supabase: { rpc: mocks.rpc, from: mocks.from } });
});

describe("currency actions", () => {
  it("normalizes and creates a tenant-owned currency", async () => {
    await expect(createCurrency({ code: " eur ", symbol: " € ", decimalPlaces: 2 })).resolves.toEqual({ ok: true });
    const chain = mocks.from.mock.results[0].value;
    expect(chain.insert).toHaveBeenCalledWith({ user_id: owner, code: "EUR", symbol: "€", decimal_places: 2 });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });

  it("updates the current normalized code and maps duplicate/used definitions", async () => {
    await expect(updateCurrency(" eur ", { code: " eur2 ", symbol: "E", decimalPlaces: 3 })).resolves.toEqual({ ok: true });
    const chain = mocks.from.mock.results[0].value;
    expect(chain.update).toHaveBeenCalledWith({ code: "EUR2", symbol: "E", decimal_places: 3 });
    expect(chain.eq).toHaveBeenCalledWith("code", "EUR");
    writeResult = { data: null, error: { code: "23505", message: "duplicate" } };
    expect(await createCurrency({ code: "EUR", symbol: "€", decimalPlaces: 2 })).toEqual({ ok: false, error: "duplicateCurrency" });
    writeResult = { data: null, error: { code: "P0001", message: "currency.used" } };
    expect(await updateCurrency("EUR", { code: "EUX", symbol: "€", decimalPlaces: 2 })).toEqual({ ok: false, error: "currencyUsed" });
  });

  it.each([
    ["currency.nonzero", "currencyNonzero"], ["currency.inUse", "currencyInUse"],
    ["currency.lastEnabled", "lastEnabledCurrency"], ["currency.lastBalance", "lastWalletBalance"],
    ["currency.unavailable", "currencyUnavailable"], ["private database detail", "failed"],
  ] as const)("maps disable failure %s to %s", async (message, error) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } });
    expect(await setCurrencyEnabled(" eur ", false)).toEqual({ ok: false, error });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("normalizes a successful enable/disable RPC and revalidates once", async () => {
    expect(await setCurrencyEnabled(" eur ", false)).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("set_currency_disabled", { p_code: "EUR", p_disabled: true });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });

  it("deletes only the normalized owned row and maps durable-use rejection", async () => {
    await expect(deleteCurrency(" eur ")).resolves.toEqual({ ok: true });
    const chain = mocks.from.mock.results[0].value;
    expect(chain.delete).toHaveBeenCalledOnce();
    expect(chain.eq).toHaveBeenCalledWith("user_id", owner);
    expect(chain.eq).toHaveBeenCalledWith("code", "EUR");
    writeResult = { data: null, error: { code: "P0001", message: "currency.used" } };
    expect(await deleteCurrency("EUR")).toEqual({ ok: false, error: "currencyUsed" });
  });

  it("inspects nonzero, dependency, and last-balance blockers without mutating", async () => {
    reads.wallet_balance_totals.data = [{ balance_id: "eur", wallet_id: "wallet", currency: "EUR", balance_minor: 50 }];
    reads.profiles.data = [{ salary_balance_id: "eur" }];
    reads.wallet_balances.data = [{ id: "eur", wallet_id: "wallet", currency: "EUR", detached_at: null }];
    expect(await inspectCurrencyDisable("EUR")).toEqual([
      { kind: "nonzeroBalance", balanceId: "eur", walletId: "wallet", walletName: "Pocket" },
      { kind: "lastWalletBalance", walletId: "wallet", walletName: "Pocket" },
      { kind: "salary", balanceId: "eur", walletId: "wallet", walletName: "Pocket" },
    ]);
    expect(mocks.rpc).not.toHaveBeenCalled();
    for (const chain of mocks.from.mock.results) {
      expect(chain.value.update).not.toHaveBeenCalled();
      expect(chain.value.delete).not.toHaveBeenCalled();
    }
  });

  it("mirrors unresolved configuration and current/future budget semantics", async () => {
    reads.currencies.data = [{ code: "EUR", disabled_at: null }];
    reads.wallet_balances.data = [{ id: "eur", wallet_id: "wallet", currency: "EUR", detached_at: null }];
    reads.fixed_expenses.data = [{ id: "fixed", name: "Rent", balance_id: "eur" }];
    reads.installments.data = [{ id: "installment", name: "Laptop", balance_id: "eur" }];
    reads.installment_progress.data = [{ installment_id: "installment", remaining_minor: 10 }];
    reads.loan_progress.data = [{ id: "loan", name: "Advance", balance_id: "eur", currency: "EUR", remaining_minor: 20, deleted_at: null }];
    reads.pending_payment_progress.data = [{ id: "pending", project: "Site", client: "Acme", currency: "EUR", remaining_minor: 30, deleted_at: null }];
    reads.budgets.data = [
      { id: "old", category_id: "food", currency: "EUR", starts_month: "2000-01-01", limit_minor: 100 },
      { id: "future", category_id: "rent", currency: "EUR", starts_month: "2099-01-01", limit_minor: 200 },
    ];
    expect(await inspectCurrencyDisable("EUR")).toEqual([
      { kind: "lastEnabledCurrency" },
      { kind: "lastWalletBalance", walletId: "wallet", walletName: "Pocket" },
      { kind: "fixedExpense", id: "fixed", name: "Rent", balanceId: "eur" },
      { kind: "installment", id: "installment", name: "Laptop", balanceId: "eur" },
      { kind: "loan", id: "loan", name: "Advance", balanceId: "eur" },
      { kind: "pendingPayment", id: "pending", label: "Acme · Site" },
      { kind: "budget", id: "old", categoryId: "food", startsMonth: "2000-01-01" },
      { kind: "budget", id: "future", categoryId: "rent", startsMonth: "2099-01-01" },
    ]);
  });

  it("reports a last-balance blocker for a Needs attention wallet", async () => {
    reads.wallets.data = [{ id: "wallet", name: "Old card", default_balance_id: "eur", deleted_at: null, needs_attention: true }];
    reads.wallet_balances.data = [{ id: "eur", wallet_id: "wallet", currency: "EUR", detached_at: null }];
    expect(await inspectCurrencyDisable("EUR")).toContainEqual({ kind: "lastWalletBalance", walletId: "wallet", walletName: "Old card" });
  });

  it("fails closed when any blocker query is unavailable", async () => {
    reads.budgets = { data: null, error: { message: "private detail" } };
    await expect(inspectCurrencyDisable("EUR")).rejects.toThrow("Currency inspection unavailable");
  });

  it("hides thrown transport diagnostics while inspecting", async () => {
    mocks.from.mockImplementationOnce(() => { throw new Error("private transport detail"); });
    await expect(inspectCurrencyDisable("EUR")).rejects.toThrow("Currency inspection unavailable");
  });

  it("fails closed when a balance has no aggregate row", async () => {
    reads.wallet_balance_totals.data = [];
    await expect(inspectCurrencyDisable("EUR")).rejects.toThrow("Currency inspection unavailable");
  });

  it("fails closed when an aggregate row has no balance identity", async () => {
    reads.wallet_balances.data = [{ id: "eur", wallet_id: "wallet", currency: "EUR", detached_at: null }];
    reads.wallet_balance_totals.data = [
      ...(reads.wallet_balance_totals.data ?? []),
      { balance_id: "orphan", wallet_id: "wallet", currency: "EUR", balance_minor: 0 },
    ];
    await expect(inspectCurrencyDisable("EUR")).rejects.toThrow("Currency inspection unavailable");
  });

  it("rejects invalid input and preserves auth failures without revalidation", async () => {
    expect(await createCurrency({ code: "bad code", symbol: "$", decimalPlaces: 2 })).toEqual({ ok: false, error: "invalid" });
    expect(mocks.actionClient).not.toHaveBeenCalled();
    mocks.actionClient.mockResolvedValue({ error: "notConfigured" });
    expect(await setCurrencyEnabled("EUR", true)).toEqual({ ok: false, error: "notConfigured" });
    mocks.actionClient.mockResolvedValue({ error: "failed" });
    expect(await deleteCurrency("EUR")).toEqual({ ok: false, error: "failed" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("contains an unexpected session transport failure", async () => {
    mocks.actionClient.mockRejectedValue(new Error("private session detail"));
    await expect(createCurrency({ code: "EUR", symbol: "€", decimalPlaces: 2 }))
      .resolves.toEqual({ ok: false, error: "failed" });
  });
});
