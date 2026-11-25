import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));
const getWallets = vi.fn();
const getCurrencies = vi.fn();
const createWallet = vi.fn();
const updateWallet = vi.fn();
const reorderWallets = vi.fn();
const deleteWallet = vi.fn();
const createTransaction = vi.fn();
const getCategories = vi.fn();
const createCategory = vi.fn();
const getProfile = vi.fn();
const balancesOut = vi.fn();
vi.mock("./queries", () => ({ getWallets: (...args: unknown[]) => getWallets(...args) }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
vi.mock("./actions", () => ({
  createWallet: (...args: unknown[]) => createWallet(...args),
  updateWallet: (...args: unknown[]) => updateWallet(...args),
  reorderWallets: (...args: unknown[]) => reorderWallets(...args),
  deleteWallet: (...args: unknown[]) => deleteWallet(...args),
}));
vi.mock("@/features/transactions/actions", () => ({ createTransaction: (...args: unknown[]) => createTransaction(...args) }));
vi.mock("@/features/categories/queries", () => ({ getCategories: () => getCategories() }));
vi.mock("@/features/categories/actions", () => ({ createCategory: (...args: unknown[]) => createCategory(...args) }));
vi.mock("@/features/profile/queries", () => ({ getProfile: () => getProfile() }));
vi.mock("@/lib/mcp/write", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp/write")>()),
  balancesOut: (...args: unknown[]) => balancesOut(...args),
}));

// The person's own connector_requests rows, as `once` sees them through RLS.
const requests: { request_id: string; tool: string; result: unknown }[] = [];
const requestTable = {
  insert: async (row: { request_id: string; tool: string }) => {
    if (requests.some((r) => r.request_id === row.request_id)) return { error: { code: "23505" } };
    requests.push({ ...row, result: null });
    return { error: null };
  },
  select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: requests.find((r) => r.request_id === id) ?? null, error: null }) }) }),
  update: (patch: { result: unknown }) => ({ eq: async (_c: string, id: string) => {
    const row = requests.find((r) => r.request_id === id);
    if (row) row.result = patch.result;
    return { error: null };
  } }),
  delete: () => ({ eq: async (_c: string, id: string) => {
    const at = requests.findIndex((r) => r.request_id === id);
    if (at >= 0) requests.splice(at, 1);
    return { error: null };
  } }),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => requestTable }) }));

import { ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT } from "@/lib/mcp/write";
import { todayIn } from "@/features/transactions/group";
import { CORRECTION_CATEGORY, walletTools } from "./mcp";

const ALL = { includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true };
const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const W3 = "33333333-3333-4333-8333-333333333333";
const B_USD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B_LBP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const B2_USD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const T2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CAT_IN = "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0";
const CAT_OUT = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const REQ = "7b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";

const balance = (id: string, currency: string, balanceMinor: number, walletId = W1) => ({
  id, walletId, currency, openingBalanceMinor: 0, balanceMinor, position: 0, detached: false,
});
const wallet = (id: string, position: number, balances: ReturnType<typeof balance>[], extra: Record<string, unknown> = {}) => ({
  id, name: `Wallet ${position}`, kind: "cash", position, deleted: false, needsAttention: false, defaultBalanceId: balances[0]?.id ?? null, balances, ...extra,
});
const tool = (name: string) => {
  const found = walletTools.find((item) => item.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
};
const BALANCES = [{ id: W1, balances: [] }];

beforeEach(() => {
  for (const mock of [getWallets, getCurrencies, createWallet, updateWallet, reorderWallets, deleteWallet, createTransaction, getCategories, createCategory, getProfile, balancesOut]) mock.mockReset();
  requests.length = 0;
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
  balancesOut.mockResolvedValue(BALANCES);
  getProfile.mockResolvedValue({ timezone: "Asia/Beirut" });
});

test("wallets_list adds amount to every balance and keeps raw fields", async () => {
  getWallets.mockResolvedValue([{
    id: "w1", name: "Pocket", kind: "cash", position: 0, deleted: false, needsAttention: false, defaultBalanceId: "b1",
    balances: [balance("b1", "USD", 1250), balance("b2", "LBP", 4250000)],
  }]);
  const [tool] = walletTools;
  expect(tool.name).toBe("wallets_list");
  expect(tool.kind).toBe("read");
  const out = (await tool.run({})) as { wallets: { balances: Record<string, unknown>[] }[] };
  expect(out.wallets[0].balances[0]).toMatchObject({ balanceMinor: 1250, amount: { minor: 1250, currency: "USD", text: "$12.50" } });
  expect(out.wallets[0].balances[1]).toMatchObject({ amount: { minor: 4250000, currency: "LBP", text: "LBP 4,250,000" } });
});

test("an unknown currency keeps raw fields and omits text", async () => {
  getWallets.mockResolvedValue([{
    id: "w1", name: "Old", kind: "cash", position: 0, deleted: false, needsAttention: false, defaultBalanceId: "b1",
    balances: [balance("b1", "EUR", 500)],
  }]);
  const out = (await walletTools[0].run({})) as { wallets: { balances: { amount: unknown }[] }[] };
  expect(out.wallets[0].balances[0].amount).toEqual({ minor: 500, currency: "EUR" });
});

test("every write tool has the right kind, a strict input that converts to JSON Schema, and a description", () => {
  const kinds = Object.fromEntries(walletTools.map((item) => [item.name, item.kind]));
  expect(kinds).toEqual({
    wallets_list: "read", wallets_create: "write", wallets_update: "write", wallets_delete: "destructive", wallets_adjust_balance: "destructive",
  });
  for (const item of walletTools.slice(1)) {
    expect(() => z.toJSONSchema(item.input!, { io: "input" })).not.toThrow();
    expect(item.input!.safeParse({ walletId: W1, targets: [], bogus: 1 }).success).toBe(false);
    expect(item.description).toMatch(/wallets_list/);
  }
});

describe("wallets_create", () => {
  const created = wallet(W3, 2, [balance(B2_USD, "USD", 1250, W3), balance(B_LBP, "LBP", 0, W3)]);

  test("creates through createWallet with the currency's units, then returns the wallet and its balances", async () => {
    createWallet.mockResolvedValue({ ok: true, id: W3 });
    getWallets.mockResolvedValue([created]);
    const out = (await tool("wallets_create").run({ name: "Savings", kind: "bank", currency: "USD", openingBalanceMinor: 1250 })) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(createWallet).toHaveBeenCalledWith({ expectedUnits: { USD: 2 }, name: "Savings", kind: "bank", currency: "USD", openingBalanceMinor: 1250 });
    expect(getWallets).toHaveBeenCalledWith(ALL);
    expect(out.wallet.id).toBe(W3);
    expect(out.wallet.balances[0].amount).toEqual({ minor: 1250, currency: "USD", text: "$12.50" });
    expect(balancesOut).toHaveBeenCalledWith([B2_USD, B_LBP]);
    expect(out.balances).toBe(BALANCES);
  });

  test("without an opening amount it opens at 0 and returns the wallet only", async () => {
    createWallet.mockResolvedValue({ ok: true, id: W3 });
    getWallets.mockResolvedValue([created]);
    const out = (await tool("wallets_create").run({ name: "Cash", kind: "cash", currency: "LBP" })) as Record<string, unknown>;
    expect(createWallet).toHaveBeenCalledWith({ expectedUnits: { LBP: 0 }, name: "Cash", kind: "cash", currency: "LBP", openingBalanceMinor: 0 });
    expect(out).not.toHaveProperty("balances");
  });

  test("a currency the person does not have is refused before any write", async () => {
    await expect(tool("wallets_create").run({ name: "X", kind: "cash", currency: "EUR" })).rejects.toThrow(ACTION_ERROR_TEXT.currencyUnavailable);
    expect(createWallet).not.toHaveBeenCalled();
  });

  test("an action error becomes its fixed sentence", async () => {
    createWallet.mockResolvedValue({ ok: false, error: "conflict" });
    const run = tool("wallets_create").run({ name: "X", kind: "cash", currency: "USD" });
    await expect(run).rejects.toBeInstanceOf(ToolError);
    await expect(tool("wallets_create").run({ name: "X", kind: "cash", currency: "USD" })).rejects.toThrow(ACTION_ERROR_TEXT.conflict);
  });

  test("the same requestId replays the first result instead of creating a second wallet", async () => {
    createWallet.mockResolvedValue({ ok: true, id: W3 });
    getWallets.mockResolvedValue([created]);
    const args = { requestId: REQ, name: "Savings", kind: "bank", currency: "USD", openingBalanceMinor: 1250 };
    const first = (await tool("wallets_create").run(args)) as Record<string, unknown>;
    const again = (await tool("wallets_create").run(args)) as Record<string, unknown>;
    expect(createWallet).toHaveBeenCalledTimes(1);
    expect(again).toEqual({ ...first, replayed: true });
    expect(requests).toEqual([{ request_id: REQ, tool: "wallets_create", result: first }]);
  });

  test("a refusal before the write frees the requestId; a failed re-read after it keeps the claim", async () => {
    await expect(tool("wallets_create").run({ requestId: REQ, name: "X", kind: "cash", currency: "EUR" })).rejects.toThrow(ACTION_ERROR_TEXT.currencyUnavailable);
    expect(requests).toEqual([]);
    createWallet.mockResolvedValue({ ok: true, id: W3 });
    getWallets.mockResolvedValue([]);
    await expect(tool("wallets_create").run({ requestId: REQ, name: "X", kind: "cash", currency: "USD" })).rejects.toThrow(ACTION_ERROR_TEXT.failed);
    expect(requests).toHaveLength(1);
  });

  test("the input schema is strict and checks every value", () => {
    const input = tool("wallets_create").input!;
    expect(input.safeParse({ name: "A", kind: "cash", currency: "USD" }).success).toBe(true);
    expect(input.safeParse({ name: "A", kind: "cash", currency: "USD", extra: true }).success).toBe(false);
    expect(input.safeParse({ name: "A", kind: "wallet", currency: "USD" }).success).toBe(false);
    expect(input.safeParse({ name: "A", kind: "cash", currency: "usd" }).success).toBe(false);
    expect(input.safeParse({ name: "", kind: "cash", currency: "USD" }).success).toBe(false);
    expect(input.safeParse({ name: "A", kind: "cash", currency: "USD", openingBalanceMinor: 1.5 }).success).toBe(false);
    expect(input.safeParse({ name: "A", kind: "cash", currency: "USD", requestId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("wallets_update", () => {
  const list = () => [
    wallet(W1, 0, [balance(B_USD, "USD", 0)]),
    wallet(W2, 1, [balance(B2_USD, "USD", 0, W2)], { kind: "bank" }),
    wallet(W3, 2, [balance(B_LBP, "LBP", 0, W3)]),
  ];

  test("a rename keeps the current kind and does not reorder", async () => {
    getWallets.mockResolvedValue(list());
    updateWallet.mockResolvedValue({ ok: true });
    const out = (await tool("wallets_update").run({ walletId: W2, name: "Main bank" })) as { wallet: { id: string } };
    expect(updateWallet).toHaveBeenCalledWith(W2, { name: "Main bank", kind: "bank" });
    expect(reorderWallets).not.toHaveBeenCalled();
    expect(out.wallet.id).toBe(W2);
  });

  test("a position sends the complete ordinary wallet list in the new order", async () => {
    getWallets.mockResolvedValue([...list(), wallet("44444444-4444-4444-8444-444444444444", 3, [], { deleted: true, defaultBalanceId: null })]);
    reorderWallets.mockResolvedValue({ ok: true });
    await tool("wallets_update").run({ walletId: W3, position: 0 });
    expect(reorderWallets).toHaveBeenCalledWith([W3, W1, W2]);
    expect(updateWallet).not.toHaveBeenCalled();
  });

  test("the same position changes nothing; a position past the end is refused", async () => {
    getWallets.mockResolvedValue(list());
    await tool("wallets_update").run({ walletId: W2, position: 1 });
    expect(reorderWallets).not.toHaveBeenCalled();
    await expect(tool("wallets_update").run({ walletId: W2, position: 3, name: "X" })).rejects.toThrow(/past the end/);
    expect(updateWallet).not.toHaveBeenCalled();
  });

  test("an unknown wallet and an action error are fixed sentences", async () => {
    getWallets.mockResolvedValue(list());
    await expect(tool("wallets_update").run({ walletId: "55555555-5555-4555-8555-555555555555", kind: "card" })).rejects.toThrow(/wallets_list/);
    reorderWallets.mockResolvedValue({ ok: false, error: "reorderConflict" });
    await expect(tool("wallets_update").run({ walletId: W1, position: 2 })).rejects.toThrow(ACTION_ERROR_TEXT.reorderConflict);
  });

  test("the input schema needs one change and rejects bad values", () => {
    const input = tool("wallets_update").input!;
    expect(input.safeParse({ walletId: W1 }).success).toBe(false);
    expect(input.safeParse({ walletId: W1, position: -1 }).success).toBe(false);
    expect(input.safeParse({ walletId: W1, kind: "purse" }).success).toBe(false);
    expect(input.safeParse({ walletId: "w1", name: "A" }).success).toBe(false);
    expect(input.safeParse({ walletId: W1, name: "A", color: "red" }).success).toBe(false);
    expect(input.safeParse({ walletId: W1, position: 0 }).success).toBe(true);
  });
});

describe("wallets_delete", () => {
  test("a wallet with every balance at zero is soft-deleted through deleteWallet", async () => {
    getWallets.mockResolvedValue([wallet(W1, 0, [balance(B_USD, "USD", 0), balance(B_LBP, "LBP", 0)])]);
    deleteWallet.mockResolvedValue({ ok: true });
    const out = await tool("wallets_delete").run({ walletId: W1 });
    expect(deleteWallet).toHaveBeenCalledWith(W1);
    expect(balancesOut).toHaveBeenCalledWith([B_USD, B_LBP]);
    expect(out).toEqual({ deleted: true, id: W1, balances: BALANCES });
  });

  test("a balance that is not zero is refused and no money moves", async () => {
    getWallets.mockResolvedValue([wallet(W1, 0, [balance(B_USD, "USD", 0), balance(B_LBP, "LBP", -5)])]);
    await expect(tool("wallets_delete").run({ walletId: W1 })).rejects.toThrow(/Bring every balance to zero first/);
    expect(deleteWallet).not.toHaveBeenCalled();
  });

  test("the database's own refusals become fixed sentences", async () => {
    getWallets.mockResolvedValue([wallet(W1, 0, [balance(B_USD, "USD", 0)])]);
    deleteWallet.mockResolvedValueOnce({ ok: false, error: "inUse" });
    await expect(tool("wallets_delete").run({ walletId: W1 })).rejects.toThrow(/still uses this wallet/);
    deleteWallet.mockResolvedValueOnce({ ok: false, error: "walletNonzero" });
    await expect(tool("wallets_delete").run({ walletId: W1 })).rejects.toThrow(/Bring every balance to zero first/);
    deleteWallet.mockResolvedValueOnce({ ok: false, error: "failed" });
    await expect(tool("wallets_delete").run({ walletId: W1 })).rejects.toThrow(ACTION_ERROR_TEXT.failed);
  });

  test("an already deleted wallet reports deleted without a second call", async () => {
    getWallets.mockResolvedValue([wallet(W1, 0, [balance(B_USD, "USD", 0)], { deleted: true })]);
    await expect(tool("wallets_delete").run({ walletId: W1 })).resolves.toEqual({ deleted: true, id: W1, balances: BALANCES });
    expect(deleteWallet).not.toHaveBeenCalled();
  });

  test("the input schema is strict", () => {
    const input = tool("wallets_delete").input!;
    expect(input.safeParse({ walletId: W1 }).success).toBe(true);
    expect(input.safeParse({ walletId: W1, settle: true }).success).toBe(false);
    expect(input.safeParse({ walletId: 7 }).success).toBe(false);
  });
});

describe("wallets_adjust_balance", () => {
  type Out = { results: Record<string, unknown>[]; balances: unknown };
  const adjust = (args: Record<string, unknown>) => tool("wallets_adjust_balance").run(args) as Promise<Out>;
  const state = (usd: number, lbp: number, otherUsd = 0) => [
    wallet(W1, 0, [balance(B_USD, "USD", usd), balance(B_LBP, "LBP", lbp)]),
    wallet(W2, 1, [balance(B2_USD, "USD", otherUsd, W2)]),
  ];
  const correction = (id: string, kind: "income" | "expense") => ({ id, kind, nameEn: "Balance correction", nameAr: null, tile: 10, color: "ochre", position: 0, parentId: null, archivedAt: null });

  test("up: one income for the difference in the reused correction category", async () => {
    getWallets.mockResolvedValueOnce(state(1000, 0)).mockResolvedValueOnce(state(1500, 0));
    getCategories.mockResolvedValue([correction(CAT_IN, "income"), correction(CAT_OUT, "expense")]);
    createTransaction.mockResolvedValue({ ok: true, id: T1, revision: 1 });
    const out = await adjust({ targets: [{ balanceId: B_USD, targetMinor: 1500 }], occurredOn: "2026-11-20", note: "Counted" });
    expect(createTransaction).toHaveBeenCalledTimes(1);
    const [input, draftId] = createTransaction.mock.calls[0];
    expect(input).toEqual({ expectedUnits: { USD: 2 }, kind: "income", occurredOn: "2026-11-20", balanceId: B_USD, amountMinor: 500, categoryId: CAT_IN, note: "Counted" });
    expect(draftId).toMatch(/^[0-9a-f-]{36}$/);
    expect(createCategory).not.toHaveBeenCalled();
    expect(out.results[0]).toMatchObject({ balanceId: B_USD, currency: "USD", previousMinor: 1000, targetMinor: 1500, transactionId: T1, matched: true });
    expect(balancesOut).toHaveBeenCalledWith([B_USD]);
    expect(out.balances).toBe(BALANCES);
  });

  test("down: one expense, creating the correction category when the person has none", async () => {
    getWallets.mockResolvedValueOnce(state(1000, 0)).mockResolvedValueOnce(state(-200, 0));
    getCategories.mockResolvedValue([{ ...correction(CAT_IN, "income") }, { ...correction("99999999-9999-4999-8999-999999999999", "expense"), archivedAt: "2026-01-01" }]);
    createCategory.mockResolvedValue({ ok: true, id: CAT_OUT });
    createTransaction.mockResolvedValue({ ok: true, id: T1, revision: 1 });
    const out = await adjust({ targets: [{ balanceId: B_USD, targetMinor: -200 }], occurredOn: "2026-11-20" });
    expect(createCategory).toHaveBeenCalledWith({ kind: "expense", nameEn: "Balance correction", nameAr: "تصحيح الرصيد", tile: 10, color: "ochre" });
    expect(CORRECTION_CATEGORY.nameAr).toBe("تصحيح الرصيد");
    expect(createTransaction.mock.calls[0][0]).toEqual({ expectedUnits: { USD: 2 }, kind: "expense", occurredOn: "2026-11-20", balanceId: B_USD, amountMinor: 1200, categoryId: CAT_OUT });
    expect(out.results[0]).toMatchObject({ previousMinor: 1000, targetMinor: -200, transactionId: T1, matched: true });
  });

  test("already equal: nothing is written and the transaction id is null", async () => {
    getWallets.mockResolvedValue(state(1000, 0));
    const out = await adjust({ targets: [{ balanceId: B_USD, targetMinor: 1000 }] });
    expect(createTransaction).not.toHaveBeenCalled();
    expect(getCategories).not.toHaveBeenCalled();
    expect(getProfile).not.toHaveBeenCalled();
    expect(out.results[0]).toMatchObject({ transactionId: null, matched: true, previousMinor: 1000, targetMinor: 1000 });
  });

  test("two currencies: each balance gets its own transaction in its own currency, never combined", async () => {
    getWallets.mockResolvedValueOnce(state(1000, 50000)).mockResolvedValueOnce(state(400, 950000));
    getCategories.mockResolvedValue([correction(CAT_IN, "income"), correction(CAT_OUT, "expense")]);
    createTransaction.mockResolvedValueOnce({ ok: true, id: T1, revision: 1 }).mockResolvedValueOnce({ ok: true, id: T2, revision: 1 });
    const out = await adjust({ targets: [{ balanceId: B_USD, targetMinor: 400 }, { balanceId: B_LBP, targetMinor: 950000 }], occurredOn: "2026-11-20" });
    expect(createTransaction.mock.calls.map(([input]) => input)).toEqual([
      { expectedUnits: { USD: 2 }, kind: "expense", occurredOn: "2026-11-20", balanceId: B_USD, amountMinor: 600, categoryId: CAT_OUT },
      { expectedUnits: { LBP: 0 }, kind: "income", occurredOn: "2026-11-20", balanceId: B_LBP, amountMinor: 900000, categoryId: CAT_IN },
    ]);
    expect(out.results.map((r) => [r.currency, r.transactionId, r.matched])).toEqual([["USD", T1, true], ["LBP", T2, true]]);
    expect(balancesOut).toHaveBeenCalledWith([B_USD, B_LBP]);
  });

  test("a balance that changed in between is reported with matched: false", async () => {
    getWallets.mockResolvedValueOnce(state(1000, 0)).mockResolvedValueOnce(state(1700, 0));
    getCategories.mockResolvedValue([correction(CAT_IN, "income")]);
    createTransaction.mockResolvedValue({ ok: true, id: T1, revision: 1 });
    const out = await adjust({ targets: [{ balanceId: B_USD, targetMinor: 1500 }], occurredOn: "2026-11-20" });
    expect(out.results[0]).toMatchObject({ matched: false, currentMinor: 1700 });
  });

  test("the date defaults to today in the person's timezone", async () => {
    getWallets.mockResolvedValue(state(0, 0));
    getProfile.mockResolvedValue({ timezone: "Pacific/Kiritimati" });
    getCategories.mockResolvedValue([correction(CAT_IN, "income")]);
    createTransaction.mockResolvedValue({ ok: true, id: T1, revision: 1 });
    await adjust({ targets: [{ balanceId: B_USD, targetMinor: 5 }] });
    expect(createTransaction.mock.calls[0][0].occurredOn).toBe(todayIn("Pacific/Kiritimati"));
  });

  test("an unknown balance is refused before any write; an action error is its fixed sentence", async () => {
    getWallets.mockResolvedValue(state(0, 0));
    await expect(adjust({ targets: [{ balanceId: B_LBP, targetMinor: 5 }, { balanceId: T1, targetMinor: 5 }] })).rejects.toThrow(/wallets_list/);
    expect(createTransaction).not.toHaveBeenCalled();
    getCategories.mockResolvedValue([correction(CAT_IN, "income")]);
    createTransaction.mockResolvedValue({ ok: false, error: "walletUnavailable" });
    await expect(adjust({ targets: [{ balanceId: B_USD, targetMinor: 5 }], occurredOn: "2026-11-20" })).rejects.toThrow(ACTION_ERROR_TEXT.walletUnavailable);
  });

  test("a deleted wallet's balance is refused when it would need a correction", async () => {
    getWallets.mockResolvedValue([wallet(W1, 0, [balance(B_USD, "USD", 0)], { deleted: true })]);
    await expect(adjust({ targets: [{ balanceId: B_USD, targetMinor: 5 }] })).rejects.toThrow(ACTION_ERROR_TEXT.walletDeleted);
    expect(createTransaction).not.toHaveBeenCalled();
  });

  test("the input schema: 1 to 20 unique targets, integers only, strict", () => {
    const input = tool("wallets_adjust_balance").input!;
    const target = { balanceId: B_USD, targetMinor: 100 };
    expect(input.safeParse({ targets: [target] }).success).toBe(true);
    expect(input.safeParse({ targets: [] }).success).toBe(false);
    expect(input.safeParse({ targets: [target, { ...target, targetMinor: 5 }] }).success).toBe(false);
    expect(input.safeParse({ targets: [{ ...target, targetMinor: 1.25 }] }).success).toBe(false);
    expect(input.safeParse({ targets: [{ ...target, currency: "USD" }] }).success).toBe(false);
    expect(input.safeParse({ targets: [target], note: "x".repeat(141) }).success).toBe(false);
    expect(input.safeParse({ targets: [target], occurredOn: "20/11/2026" }).success).toBe(false);
    expect(input.safeParse({ targets: [target], requestId: REQ }).success).toBe(false);
  });
});
