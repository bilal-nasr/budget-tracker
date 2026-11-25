import { beforeEach, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
import { ACTION_ERROR_TEXT } from "@/lib/mcp/write";

vi.mock("server-only", () => ({}));
const getInstallments = vi.fn();
const getProfile = vi.fn();
const getCurrencies = vi.fn();
const createInstallment = vi.fn();
const updateInstallment = vi.fn();
const deleteInstallment = vi.fn();
const getWallets = vi.fn();
vi.mock("./actions", () => ({
  createInstallment: (...a: unknown[]) => createInstallment(...a),
  updateInstallment: (...a: unknown[]) => updateInstallment(...a),
  deleteInstallment: (...a: unknown[]) => deleteInstallment(...a),
}));
vi.mock("@/features/wallets/queries", () => ({ getWallets: (...args: unknown[]) => getWallets(...args) }));
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
vi.mock("./queries", () => ({ getInstallments: (...args: unknown[]) => getInstallments(...args) }));
vi.mock("@/features/profile/queries", () => ({ getProfile: () => getProfile() }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
import { installmentTools } from "./mcp";

const ID = "7b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const NEW_ID = "9b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const CAT = "6b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const BAL = "5b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const BAL2 = "4b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const REQUEST = "11111111-2222-4333-8444-555555555555";
type Out = { installments: Record<string, unknown>[] };

beforeEach(() => {
  vi.resetAllMocks();
  rows.length = 0;
  getWallets.mockResolvedValue([{ id: "w1", balances: [{ id: BAL, currency: "USD" }, { id: BAL2, currency: "LBP" }] }]);
  getProfile.mockResolvedValue({ timezone: "Asia/Beirut" });
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
});

test("installments_list adds amounts for every figure and leaves out the never-filled payment history", async () => {
  getInstallments.mockResolvedValue([{
    id: "i1", name: "Laptop", currency: "USD", balanceId: "b1", categoryId: "c1", totalMinor: 120000, paidBeforeMinor: 10000,
    monthlyMinor: 20000, dueDay: 3, paidMinor: 30000, remainingMinor: 90000, salaryCycleId: "s1", paidThisCycleMinor: 20000,
    cyclePaymentCount: 1, cycleLatestPaymentId: "t1", cycleStatus: "paid",
    // What getCycleSummary really returns: no history, flagged incomplete.
    payments: [], historyComplete: false,
  }, {
    id: "i2", name: "Open", currency: "LBP", balanceId: "b2", categoryId: "c1", totalMinor: 900000, paidBeforeMinor: 0,
    monthlyMinor: null, dueDay: null, paidMinor: 0, remainingMinor: 900000, salaryCycleId: null, paidThisCycleMinor: 0,
    cyclePaymentCount: 0, cycleLatestPaymentId: null, cycleStatus: "unpaid", payments: [], historyComplete: false,
  }]);
  const [tool] = installmentTools;
  expect(tool.name).toBe("installments_list");
  expect(tool.kind).toBe("read");
  const out = (await tool.run({})) as Out;
  expect(getInstallments).toHaveBeenCalledWith("Asia/Beirut");
  const first = out.installments[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(first.totalMinor).toBe(120000);
  expect(first.total).toEqual({ minor: 120000, currency: "USD", text: "$1,200.00" });
  expect(first.paidBefore.text).toBe("$100.00");
  expect(first.monthly.text).toBe("$200.00");
  expect(first.paid.text).toBe("$300.00");
  expect(first.remaining.text).toBe("$900.00");
  expect(first.paidThisCycle.text).toBe("$200.00");
  for (const installment of out.installments) {
    expect(installment).not.toHaveProperty("payments");
    expect(installment).not.toHaveProperty("historyComplete");
  }
  expect(first).toMatchObject({ cyclePaymentCount: 1, cycleLatestPaymentId: "t1", cycleStatus: "paid" });
  expect(out.installments[1]).toMatchObject({ monthly: null, total: { currency: "LBP", text: "LBP 900,000" } });
});

test("installments_list does not promise a payment history it never returns", () => {
  const [tool] = installmentTools;
  expect(tool.description).not.toMatch(/every recorded payment|newest first/i);
  expect(tool.description).toMatch(/paid so far/i);
  expect(tool.description).toMatch(/remaining/i);
});

const plan = (over: Record<string, unknown> = {}) => ({
  id: ID, name: "Laptop", currency: "USD", balanceId: BAL, categoryId: CAT, totalMinor: 120000, paidBeforeMinor: 10000,
  monthlyMinor: 20000, dueDay: 3, paidMinor: 10000, remainingMinor: 110000, salaryCycleId: null, paidThisCycleMinor: 0,
  cyclePaymentCount: 0, cycleLatestPaymentId: null, cycleStatus: "unpaid", payments: [], historyComplete: false, ...over,
});
const tool = (name: string) => installmentTools.find((t) => t.name === name)!;

test("kinds", () => {
  expect(tool("installments_create").kind).toBe("write");
  expect(tool("installments_update").kind).toBe("write");
  expect(tool("installments_delete").kind).toBe("destructive");
});

test("installments_create sends a server-built intent and returns the new plan found by list diff", async () => {
  getInstallments.mockResolvedValueOnce([plan()]).mockResolvedValueOnce([plan(), plan({ id: NEW_ID, name: "Phone" })]);
  createInstallment.mockResolvedValue({ ok: true });
  const out = (await tool("installments_create").run({ name: "Phone", totalMinor: 50000, balanceId: BAL, categoryId: CAT })) as { installment: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(createInstallment).toHaveBeenCalledWith({ expectedUnits: { USD: 2 }, name: "Phone", totalMinor: 50000, paidBeforeMinor: 0, balanceId: BAL, categoryId: CAT, monthlyMinor: null, dueDay: null });
  expect(out.installment).toMatchObject({ id: NEW_ID, total: { text: "$1,200.00" } });
  expect(out.installment).not.toHaveProperty("payments");
});

test("installments_create returns the fresh list when the new plan is not identifiable", async () => {
  getInstallments.mockResolvedValue([plan()]);
  createInstallment.mockResolvedValue({ ok: true });
  const out = (await tool("installments_create").run({ name: "Phone", totalMinor: 50000, paidBeforeMinor: 100, balanceId: BAL2, categoryId: CAT, monthlyMinor: 5000, dueDay: 7 })) as Record<string, unknown>;
  expect(createInstallment).toHaveBeenCalledWith(expect.objectContaining({ expectedUnits: { LBP: 0 }, paidBeforeMinor: 100, monthlyMinor: 5000, dueDay: 7 }));
  expect(out.installment).toBeNull();
  expect(out.installments).toHaveLength(1);
  expect(String(out.note)).toMatch(/fresh list/);
});

test("installments_create: unknown balance never reaches the action; action errors are fixed sentences", async () => {
  await expect(tool("installments_create").run({ name: "X", totalMinor: 1, balanceId: "7c6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b", categoryId: CAT })).rejects.toThrow(ACTION_ERROR_TEXT.walletUnavailable);
  expect(createInstallment).not.toHaveBeenCalled();
  getInstallments.mockResolvedValue([]);
  createInstallment.mockResolvedValue({ ok: false, error: "categoryUnavailable" });
  await expect(tool("installments_create").run({ name: "X", totalMinor: 1, balanceId: BAL, categoryId: CAT })).rejects.toThrow(ACTION_ERROR_TEXT.categoryUnavailable);
});

test("installments_create does not create twice for the same requestId", async () => {
  getInstallments.mockResolvedValueOnce([]).mockResolvedValueOnce([plan({ id: NEW_ID })]);
  createInstallment.mockResolvedValue({ ok: true });
  const args = { requestId: REQUEST, name: "Phone", totalMinor: 50000, balanceId: BAL, categoryId: CAT };
  const first = await tool("installments_create").run(args);
  const second = await tool("installments_create").run(args);
  expect(createInstallment).toHaveBeenCalledTimes(1);
  expect(second).toEqual({ ...(first as object), replayed: true });
});

test("installments_create input rejects unknown keys and bad values", () => {
  const input = tool("installments_create").input!;
  const ok = { name: "Phone", totalMinor: 100, balanceId: BAL, categoryId: CAT };
  expect(input.safeParse(ok).success).toBe(true);
  expect(input.safeParse({ ...ok, expectedUnits: { USD: 2 } }).success).toBe(false);
  expect(input.safeParse({ ...ok, totalMinor: 0 }).success).toBe(false);
  expect(input.safeParse({ ...ok, paidBeforeMinor: 101 }).success).toBe(false);
  expect(input.safeParse({ ...ok, paidBeforeMinor: -1 }).success).toBe(false);
  expect(input.safeParse({ ...ok, monthlyMinor: 0 }).success).toBe(false);
  expect(input.safeParse({ ...ok, dueDay: 0 }).success).toBe(false);
  expect(input.safeParse({ ...ok, name: " " }).success).toBe(false);
});

test("installments_update fills omitted fields from the current row and re-reads", async () => {
  getInstallments.mockResolvedValueOnce([plan()]).mockResolvedValueOnce([plan({ totalMinor: 150000 })]);
  updateInstallment.mockResolvedValue({ ok: true });
  const out = (await tool("installments_update").run({ id: ID, totalMinor: 150000 })) as { installment: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(updateInstallment).toHaveBeenCalledWith(ID, { expectedUnits: { USD: 2 }, name: "Laptop", totalMinor: 150000, paidBeforeMinor: 10000, balanceId: BAL, categoryId: CAT, monthlyMinor: 20000, dueDay: 3 });
  expect(out.installment.total.text).toBe("$1,500.00");
});

test("installments_update: null clears monthly and dueDay; errors are fixed; unknown id is refused", async () => {
  getInstallments.mockResolvedValue([plan()]);
  updateInstallment.mockResolvedValue({ ok: true });
  await tool("installments_update").run({ id: ID, monthlyMinor: null, dueDay: null });
  expect(updateInstallment).toHaveBeenCalledWith(ID, expect.objectContaining({ monthlyMinor: null, dueDay: null }));
  updateInstallment.mockResolvedValue({ ok: false, error: "totalBelowPaid" });
  await expect(tool("installments_update").run({ id: ID, totalMinor: 1 })).rejects.toThrow(ACTION_ERROR_TEXT.totalBelowPaid);
  getInstallments.mockResolvedValue([]);
  await expect(tool("installments_update").run({ id: ID })).rejects.toThrow(/does not exist/);
});

test("installments_update input rejects unknown keys and bad values", () => {
  const input = tool("installments_update").input!;
  expect(input.safeParse({ id: ID, monthlyMinor: null }).success).toBe(true);
  expect(input.safeParse({ id: ID, requestId: REQUEST }).success).toBe(false);
  expect(input.safeParse({ id: "x" }).success).toBe(false);
  expect(input.safeParse({ id: ID, totalMinor: 0 }).success).toBe(false);
});

test("installments_delete returns { deleted, id }", async () => {
  getInstallments.mockResolvedValue([plan()]);
  deleteInstallment.mockResolvedValue({ ok: true });
  await expect(tool("installments_delete").run({ id: ID })).resolves.toEqual({ deleted: true, id: ID });
  expect(deleteInstallment).toHaveBeenCalledWith(ID);
  deleteInstallment.mockResolvedValue({ ok: false, error: "failed" });
  await expect(tool("installments_delete").run({ id: ID })).rejects.toThrow(ACTION_ERROR_TEXT.failed);
  expect(tool("installments_delete").input!.safeParse({ id: ID, x: 1 }).success).toBe(false);
});
