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
  let key = "id"; let after: string | null = null; let limit = 1000;
  for (const method of ["select", "insert", "update", "delete", "eq", "order"]) value[method] = vi.fn().mockReturnValue(value);
  value.order = vi.fn((column: string) => { key = column; return value; });
  value.gt = vi.fn((_column: string, cursor: string) => { after = cursor; return value; });
  value.limit = vi.fn((size: number) => { limit = size; return value; });
  value.single = vi.fn(() => Promise.resolve(writeResult));
  value.maybeSingle = vi.fn(() => Promise.resolve(writeResult));
  value.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ ...reads[table], data: reads[table]?.data?.filter((row) => after === null || String((row as Record<string, unknown>)[key]) > after).sort((a, b) => String((a as Record<string, unknown>)[key]).localeCompare(String((b as Record<string, unknown>)[key]))).slice(0, limit) ?? null }).then(resolve);
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  writeResult = { data: null, error: null };
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
  mocks.rpc.mockImplementation(() => Promise.resolve(writeResult));
  mocks.actionClient.mockResolvedValue({ userId: owner, supabase: { rpc: mocks.rpc, from: mocks.from } });
});

describe("currency actions", () => {
  it("normalizes and creates a tenant-owned currency", async () => {
    await expect(createCurrency({ code: " eur ", symbol: " € ", decimalPlaces: 2 })).resolves.toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("create_currency", { p_code: "EUR", p_symbol: "€", p_decimal_places: 2 });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });

  it("updates the current normalized code and maps duplicate/used definitions", async () => {
    await expect(updateCurrency(" eur ", { code: " eur2 ", symbol: "E", decimalPlaces: 3 })).resolves.toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("update_currency", { p_current_code: "EUR", p_code: "EUR2", p_symbol: "E", p_decimal_places: 3 });
    expect(mocks.from).not.toHaveBeenCalled();
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

  it("atomically deletes the normalized owned definition and maps durable-use rejection", async () => {
    await expect(deleteCurrency(" eur ")).resolves.toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("delete_currency", { p_code: "EUR" });
    expect(mocks.from).not.toHaveBeenCalled();
    writeResult = { data: null, error: { code: "P0001", message: "currency.used" } };
    expect(await deleteCurrency("EUR")).toEqual({ ok: false, error: "currencyUsed" });
  });

  it("enables globally through the same RPC with disabled false", async () => {
    expect(await setCurrencyEnabled(" eur ", true)).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("set_currency_disabled", { p_code: "EUR", p_disabled: false });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });

  const mutations = [
    ["create", () => createCurrency({ code: "EUR", symbol: "€", decimalPlaces: 2 })],
    ["update", () => updateCurrency("EUR", { code: "EUR", symbol: "€", decimalPlaces: 2 })],
    ["delete", () => deleteCurrency("EUR")],
    ["enable", () => setCurrencyEnabled("EUR", true)],
    ["disable", () => setCurrencyEnabled("EUR", false)],
  ] as const;

  it.each(mutations)("%s accepts a void RPC response and revalidates only success", async (_name, mutate) => {
    writeResult = { data: null, error: null };
    expect(await mutate()).toEqual({ ok: true });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
    mocks.revalidatePath.mockClear();
    writeResult = { data: null, error: { message: "currency.unavailable" } };
    expect(await mutate()).toEqual({ ok: false, error: "currencyUnavailable" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    mocks.rpc.mockRejectedValueOnce(new Error("private transport detail"));
    expect(await mutate()).toEqual({ ok: false, error: "failed" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "40001", message: "private serialization detail" }, "conflict"],
    [{ code: "40P01", message: "private deadlock detail" }, "conflict"],
    [{ message: "currency.incompleteCoverage" }, "conflict"],
    [{ message: "currency.lifecycleRequired" }, "conflict"],
    [{ message: "balance.globalCurrency" }, "conflict"],
  ] as const)("maps global lifecycle conflict %o", async (error, expected) => {
    writeResult = { data: null, error };
    expect(await createCurrency({ code: "EUR", symbol: "€", decimalPlaces: 2 })).toEqual({ ok: false, error: expected });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
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
      { kind: "budget", id: "future", categoryId: "rent", startsMonth: "2099-01-01" },
      { kind: "budget", id: "old", categoryId: "food", startsMonth: "2000-01-01" },
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

it("fails closed on missing or duplicate installment progress", async () => {
  reads.wallet_balances.data = [{ id: "eur", wallet_id: "wallet", currency: "EUR", detached_at: null }];
  reads.installments.data = [{ id: "late", name: "Laptop", balance_id: "eur" }];
  await expect(inspectCurrencyDisable("EUR")).rejects.toThrow("Currency inspection unavailable");
  reads.installment_progress.data = [{ installment_id: "late", remaining_minor: 0 }, { installment_id: "late", remaining_minor: 20 }];
  await expect(inspectCurrencyDisable("EUR")).rejects.toThrow("Currency inspection unavailable");
});

it("traverses independent late pages for catalog, balances and every blocker family", async () => {
  const padding = Array.from({ length: 1001 }, (_, n) => String(n).padStart(4, "0"));
  reads.currencies.data = [...padding.map((n) => ({ code: `C${n}`, disabled_at: null })), { code: "ZZZ", disabled_at: null }];
  reads.wallets.data = padding.map((n) => ({ id: n, name: n, default_balance_id: n, deleted_at: null, needs_attention: false }));
  reads.wallet_balances.data = padding.map((n) => ({ id: n, wallet_id: n, currency: "C0000", detached_at: null }));
  reads.wallet_balance_totals.data = padding.map((n) => ({ balance_id: n, wallet_id: n, currency: "C0000", balance_minor: 0 }));
  reads.wallets.data.push({ id: "z", name: "Late wallet", default_balance_id: "z", deleted_at: null });
  reads.wallet_balances.data.push({ id: "z", wallet_id: "z", currency: "ZZZ", detached_at: null });
  reads.wallet_balance_totals.data.push({ balance_id: "z", wallet_id: "z", currency: "ZZZ", balance_minor: 1 });
  reads.profiles.data = [{ salary_balance_id: "z" }];
  reads.fixed_expenses.data = [...padding.map((id) => ({ id, name: id, balance_id: id })), { id: "z", name: "Late fixed", balance_id: "z" }];
  reads.installments.data = [...padding.map((id) => ({ id, name: id, balance_id: id })), { id: "z", name: "Late installment", balance_id: "z" }];
  reads.installment_progress.data = [...padding.map((installment_id) => ({ installment_id, remaining_minor: 0 })), { installment_id: "z", remaining_minor: 1 }];
  reads.loan_progress.data = [...padding.map((id) => ({ id, name: id, balance_id: id, currency: "C0000", remaining_minor: 0, deleted_at: null })), { id: "z", name: "Late loan", balance_id: "z", currency: "ZZZ", remaining_minor: 1, deleted_at: null }];
  reads.pending_payment_progress.data = [...padding.map((id) => ({ id, currency: "C0000", remaining_minor: 0, deleted_at: null })), { id: "z", client: "Late", project: "Project", currency: "ZZZ", remaining_minor: 1, deleted_at: null }];
  reads.budgets.data = [...padding.map((id) => ({ id, currency: "C0000", category_id: id, starts_month: "2000-01-01", limit_minor: 0 })), { id: "z", category_id: "z", currency: "ZZZ", starts_month: "2099-01-01", limit_minor: 1 }];
  const blockers = await inspectCurrencyDisable("ZZZ");
  expect(blockers.map((entry) => entry.kind)).toEqual(["nonzeroBalance", "lastWalletBalance", "salary", "fixedExpense", "installment", "loan", "pendingPayment", "budget"]);
  expect(mocks.rpc).not.toHaveBeenCalled();
  for (const result of mocks.from.mock.results) expect(result.value.eq).toHaveBeenCalledWith("user_id", owner);
});

it.each(["wallet", "catalog", "fixed", "salary", "loan", "pending", "progress"])("fails closed on an incomplete %s inspection join", async (join) => {
 reads.wallet_balances.data=[{id:"eur",wallet_id:"wallet",currency:"EUR",detached_at:null}];
 if(join==="wallet") reads.wallets.data=[];
 if(join==="catalog") reads.wallet_balances.data=[{id:"eur",wallet_id:"wallet",currency:"MISSING",detached_at:null}];
 if(join==="fixed") reads.fixed_expenses.data=[{id:"bad",balance_id:"missing"}];
 if(join==="salary") reads.profiles.data=[{salary_balance_id:"missing"}];
 if(join==="loan") reads.loan_progress.data=[{id:"bad",balance_id:"eur",currency:"USD",remaining_minor:1,deleted_at:null}];
 if(join==="pending") reads.pending_payment_progress.data=[{id:"bad",currency:"MISSING",remaining_minor:1,deleted_at:null}];
 if(join==="progress") reads.installment_progress.data=[{installment_id:"orphan",remaining_minor:1}];
 await expect(inspectCurrencyDisable("EUR")).rejects.toThrow("Currency inspection unavailable");
});
