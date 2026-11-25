import { beforeEach, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
import { ACTION_ERROR_TEXT } from "@/lib/mcp/write";

vi.mock("server-only", () => ({}));
const getFixedExpenses = vi.fn();
const getWallets = vi.fn();
const getProfile = vi.fn();
const getCurrencies = vi.fn();
const createFixedExpense = vi.fn();
const updateFixedExpense = vi.fn();
const deleteFixedExpense = vi.fn();
vi.mock("./actions", () => ({
  createFixedExpense: (...a: unknown[]) => createFixedExpense(...a),
  updateFixedExpense: (...a: unknown[]) => updateFixedExpense(...a),
  deleteFixedExpense: (...a: unknown[]) => deleteFixedExpense(...a),
}));
const rows: { request_id: string; tool: string; result: unknown }[] = [];
const table = {
  insert: async (row: { request_id: string; tool: string }) => {
    if (rows.some((r) => r.request_id === row.request_id)) return { error: { code: "23505" } };
    rows.push({ ...row, result: null });
    return { error: null };
  },
  select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: rows.find((r) => r.request_id === id) ?? null, error: null }) }) }),
  update: (patch: { result: unknown }) => ({ eq: async (_c: string, id: string) => { const r = rows.find((x) => x.request_id === id); if (r) r.result = patch.result; return { error: null }; } }),
  delete: () => ({ eq: async () => ({ error: null }) }),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => table }) }));
vi.mock("./queries", () => ({ getFixedExpenses: (...args: unknown[]) => getFixedExpenses(...args) }));
vi.mock("@/features/wallets/queries", () => ({ getWallets: (...args: unknown[]) => getWallets(...args) }));
vi.mock("@/features/profile/queries", () => ({ getProfile: () => getProfile() }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
import { fixedTools } from "./mcp";

type Out = { expenses: Record<string, unknown>[] };
const wallet = (balances: { id: string; currency: string }[]) => ({ id: "w1", balances });

beforeEach(() => {
  vi.resetAllMocks();
  rows.length = 0;
  getProfile.mockResolvedValue({ timezone: "Asia/Beirut" });
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
  getWallets.mockResolvedValue([wallet([{ id: "b1", currency: "USD" }, { id: "b2", currency: "LBP" }])]);
});

test("fixed_expenses_list passes the timezone and adds amounts in the paying balance's currency, items included", async () => {
  getFixedExpenses.mockResolvedValue([
    { id: "f1", name: "Rent", amountMinor: 30000, balanceId: "b1", categoryId: "c1", dueDay: 5, paidOn: null, items: [{ description: "Base", amountMinor: 25000 }] },
    { id: "f2", name: "Generator", amountMinor: 1500000, balanceId: "b2", categoryId: "c1", dueDay: null, paidOn: "2026-11-02" },
  ]);
  const [tool] = fixedTools;
  expect(tool.name).toBe("fixed_expenses_list");
  expect(tool.kind).toBe("read");
  const out = (await tool.run({})) as Out;
  expect(getFixedExpenses).toHaveBeenCalledWith("Asia/Beirut");
  expect(out.expenses[0]).toMatchObject({
    amountMinor: 30000, currency: "USD", amount: { minor: 30000, currency: "USD", text: "$300.00" },
    items: [{ amountMinor: 25000, amount: { minor: 25000, currency: "USD", text: "$250.00" } }],
  });
  expect(out.expenses[1]).toMatchObject({ amount: { minor: 1500000, currency: "LBP", text: "LBP 1,500,000" } });
  expect(out.expenses[1]).not.toHaveProperty("items");
});

test("an unresolvable balance leaves the expense raw", async () => {
  getFixedExpenses.mockResolvedValue([{ id: "f1", name: "Old", amountMinor: 100, balanceId: "gone", categoryId: "c1", dueDay: null, paidOn: null }]);
  const out = (await fixedTools[0].run({})) as Out;
  expect(out.expenses[0]).toEqual({ id: "f1", name: "Old", amountMinor: 100, balanceId: "gone", categoryId: "c1", dueDay: null, paidOn: null });
});

test("fixed_expenses_list describes paidOn as the query computes it", () => {
  const { description } = fixedTools[0];
  // Newest payment recorded since the latest salary receipt was recorded; with no salary yet, this calendar month.
  expect(description).toMatch(/since the latest salary/i);
  expect(description).toMatch(/calendar month/i);
  expect(description).toMatch(/newest/i);
});

const ID = "7b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const NEW_ID = "9b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const CAT = "6b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const BAL = "5b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const REQUEST = "11111111-2222-4333-8444-555555555555";
const rent = { id: ID, name: "Rent", amountMinor: 30000, balanceId: "b1", categoryId: CAT, dueDay: 5, paidOn: null, items: [] };
const tool = (name: string) => fixedTools.find((t) => t.name === name)!;
const walletWith = () => getWallets.mockResolvedValue([wallet([{ id: BAL, currency: "USD" }, { id: "b1", currency: "USD" }, { id: "b2", currency: "LBP" }])]);

test("kinds", () => {
  expect(tool("fixed_expenses_create").kind).toBe("write");
  expect(tool("fixed_expenses_update").kind).toBe("write");
  expect(tool("fixed_expenses_delete").kind).toBe("destructive");
});

test("fixed_expenses_create sends a server-built intent and returns the new row found by list diff", async () => {
  walletWith();
  const created = { ...rent, id: NEW_ID, name: "Internet", balanceId: BAL };
  getFixedExpenses.mockResolvedValueOnce([rent]).mockResolvedValueOnce([rent, created]);
  createFixedExpense.mockResolvedValue({ ok: true });
  const out = (await tool("fixed_expenses_create").run({ name: "Internet", amountMinor: 2500, balanceId: BAL, categoryId: CAT })) as { expense: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(createFixedExpense).toHaveBeenCalledWith({ expectedUnits: { USD: 2 }, name: "Internet", amountMinor: 2500, balanceId: BAL, categoryId: CAT, dueDay: null, items: [] });
  expect(out.expense).toMatchObject({ id: NEW_ID, currency: "USD", amount: { text: "$300.00" } });
});

test("fixed_expenses_create returns the fresh list when the new row is not identifiable", async () => {
  walletWith();
  getFixedExpenses.mockResolvedValue([rent]);
  createFixedExpense.mockResolvedValue({ ok: true });
  const out = (await tool("fixed_expenses_create").run({ name: "Internet", amountMinor: 2500, balanceId: BAL, categoryId: CAT, dueDay: 9 })) as Record<string, unknown>;
  expect(out.expense).toBeNull();
  expect(out.expenses).toHaveLength(1);
  expect(String(out.note)).toMatch(/fresh list/);
});

test("fixed_expenses_create: unknown balance never reaches the action; action errors are fixed sentences", async () => {
  walletWith();
  await expect(tool("fixed_expenses_create").run({ name: "X", amountMinor: 1, balanceId: "7c6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b", categoryId: CAT })).rejects.toThrow(ACTION_ERROR_TEXT.walletUnavailable);
  expect(createFixedExpense).not.toHaveBeenCalled();
  getFixedExpenses.mockResolvedValue([]);
  createFixedExpense.mockResolvedValue({ ok: false, error: "categoryUnavailable" });
  await expect(tool("fixed_expenses_create").run({ name: "X", amountMinor: 1, balanceId: BAL, categoryId: CAT })).rejects.toThrow(ACTION_ERROR_TEXT.categoryUnavailable);
});

test("fixed_expenses_create does not create twice for the same requestId", async () => {
  walletWith();
  getFixedExpenses.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...rent, id: NEW_ID, balanceId: BAL }]);
  createFixedExpense.mockResolvedValue({ ok: true });
  const args = { requestId: REQUEST, name: "Internet", amountMinor: 2500, balanceId: BAL, categoryId: CAT };
  const first = await tool("fixed_expenses_create").run(args);
  const second = await tool("fixed_expenses_create").run(args);
  expect(createFixedExpense).toHaveBeenCalledTimes(1);
  expect(second).toEqual({ ...(first as object), replayed: true });
});

test("fixed_expenses_create input rejects unknown keys and bad values", () => {
  const input = tool("fixed_expenses_create").input!;
  const ok = { name: "Rent", amountMinor: 100, balanceId: BAL, categoryId: CAT };
  expect(input.safeParse(ok).success).toBe(true);
  expect(input.safeParse({ ...ok, expectedUnits: { USD: 2 } }).success).toBe(false);
  expect(input.safeParse({ ...ok, name: "" }).success).toBe(false);
  expect(input.safeParse({ ...ok, amountMinor: 0 }).success).toBe(false);
  expect(input.safeParse({ ...ok, amountMinor: 1.5 }).success).toBe(false);
  expect(input.safeParse({ ...ok, dueDay: 32 }).success).toBe(false);
  expect(input.safeParse({ ...ok, balanceId: "x" }).success).toBe(false);
  expect(input.safeParse({ ...ok, items: [{ description: "a", amountMinor: 1, x: 1 }] }).success).toBe(false);
});

test("fixed_expenses_update fills omitted fields from the current row and re-reads", async () => {
  walletWith();
  const updated = { ...rent, amountMinor: 35000 };
  getFixedExpenses.mockResolvedValueOnce([rent]).mockResolvedValueOnce([updated]);
  updateFixedExpense.mockResolvedValue({ ok: true });
  const out = (await tool("fixed_expenses_update").run({ id: ID, amountMinor: 35000 })) as { expense: Record<string, unknown> };
  expect(updateFixedExpense).toHaveBeenCalledWith(ID, { expectedUnits: { USD: 2 }, name: "Rent", amountMinor: 35000, balanceId: "b1", categoryId: CAT, dueDay: 5, items: [] });
  expect(out.expense).toMatchObject({ id: ID, amountMinor: 35000, amount: { text: "$350.00" } });
});

test("fixed_expenses_update: null dueDay clears; moving to an LBP balance uses LBP units; errors are fixed", async () => {
  walletWith();
  getFixedExpenses.mockResolvedValue([rent]);
  updateFixedExpense.mockResolvedValue({ ok: true });
  await tool("fixed_expenses_update").run({ id: ID, dueDay: null, balanceId: "b2" });
  expect(updateFixedExpense).toHaveBeenCalledWith(ID, expect.objectContaining({ expectedUnits: { LBP: 0 }, dueDay: null, balanceId: "b2" }));
  updateFixedExpense.mockResolvedValue({ ok: false, error: "conflict" });
  await expect(tool("fixed_expenses_update").run({ id: ID })).rejects.toThrow(ACTION_ERROR_TEXT.conflict);
  getFixedExpenses.mockResolvedValue([]);
  await expect(tool("fixed_expenses_update").run({ id: ID })).rejects.toThrow(/does not exist/);
});

test("fixed_expenses_update input rejects unknown keys and bad values", () => {
  const input = tool("fixed_expenses_update").input!;
  expect(input.safeParse({ id: ID, dueDay: null }).success).toBe(true);
  expect(input.safeParse({ id: ID, requestId: REQUEST }).success).toBe(false);
  expect(input.safeParse({ id: "x" }).success).toBe(false);
  expect(input.safeParse({ id: ID, amountMinor: -1 }).success).toBe(false);
});

test("fixed_expenses_delete returns { deleted, id }", async () => {
  getFixedExpenses.mockResolvedValue([rent]);
  deleteFixedExpense.mockResolvedValue({ ok: true });
  await expect(tool("fixed_expenses_delete").run({ id: ID })).resolves.toEqual({ deleted: true, id: ID });
  expect(deleteFixedExpense).toHaveBeenCalledWith(ID);
  deleteFixedExpense.mockResolvedValue({ ok: false, error: "failed" });
  await expect(tool("fixed_expenses_delete").run({ id: ID })).rejects.toThrow(ACTION_ERROR_TEXT.failed);
  expect(tool("fixed_expenses_delete").input!.safeParse({ id: ID, x: 1 }).success).toBe(false);
  expect(tool("fixed_expenses_delete").input!.safeParse({ id: "bad" }).success).toBe(false);
});
