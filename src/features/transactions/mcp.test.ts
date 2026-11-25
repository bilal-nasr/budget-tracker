import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));
const fetchTransactions = vi.fn();
const getCurrencies = vi.fn();
const getWallets = vi.fn();
const getProfile = vi.fn();
const balancesOut = vi.fn();
const actions = vi.hoisted(() => ({
  createTransaction: vi.fn(), createTransfer: vi.fn(), updateTransaction: vi.fn(),
  correctTransactionDate: vi.fn(), deleteTransaction: vi.fn(), restoreTransaction: vi.fn(),
}));
vi.mock("@/features/wallets/queries", () => ({ getWallets: (...args: unknown[]) => getWallets(...args) }));
vi.mock("./queries", () => ({ fetchTransactions: (...args: unknown[]) => fetchTransactions(...args) }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
vi.mock("@/features/profile/queries", () => ({ getProfile: () => getProfile() }));
vi.mock("./actions", () => Object.fromEntries(Object.entries(actions).map(([name, mock]) => [name, (...args: unknown[]) => mock(...args)])));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => { throw new Error("no database in tests"); } }));
vi.mock("@/lib/mcp/write", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp/write")>()),
  balancesOut: (...args: unknown[]) => balancesOut(...args),
}));
import { ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT } from "@/lib/mcp/write";
import { todayIn } from "./group";
import { transactionTools } from "./mcp";

const [tool] = transactionTools;
const next = { occurredOn: "2026-11-01", createdAt: "2026-11-01T10:00:00Z", id: "6f1c3a0e-8a4e-4a53-9b3a-1d0f6a2d7c11" };
const ALL = { includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true };

const B_USD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B_LBP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const B2_USD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const B_SYP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const T1 = "11111111-1111-4111-8111-111111111111";
const CAT = "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0";
const REQ = "7b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const BALANCES = [{ id: "w1", balances: [] }];

beforeEach(() => {
  fetchTransactions.mockReset();
  getCurrencies.mockReset();
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
  getWallets.mockReset();
  getWallets.mockResolvedValue([
    { id: "w1", balances: [{ id: "b-usd", currency: "USD" }, { id: "b-lbp", currency: "LBP" }, { id: B_USD, currency: "USD" }, { id: B_LBP, currency: "LBP" }] },
    { id: "w2", balances: [{ id: "b-syp", currency: "SYP" }, { id: B2_USD, currency: "USD" }, { id: B_SYP, currency: "SYP" }] },
  ]);
  getProfile.mockReset();
  getProfile.mockResolvedValue({ timezone: "Asia/Beirut" });
  balancesOut.mockReset();
  balancesOut.mockResolvedValue(BALANCES);
  for (const mock of Object.values(actions)) mock.mockReset();
});

test("transactions_list maps arguments, adds amount and passes next through", async () => {
  fetchTransactions.mockResolvedValue({
    rows: [{ id: "t1", kind: "expense", amountMinor: 450, currency: "USD", loanPrincipalMinor: null, loanFeeMinor: null, toBalanceId: null, toAmountMinor: null, items: [], settlement: null }],
    next,
  });
  expect(tool.name).toBe("transactions_list");
  expect(tool.kind).toBe("read");
  const out = (await tool.run({ filters: { kind: "expense" }, cursor: next })) as { rows: Record<string, unknown>[]; next: unknown };
  expect(fetchTransactions).toHaveBeenCalledWith({ kind: "expense" }, next);
  expect(out.rows[0]).toMatchObject({ amountMinor: 450, amount: { minor: 450, currency: "USD", text: "$4.50" } });
  expect(out.next).toBe(next);
});

test("transactions_list defaults to no filters and no cursor", async () => {
  fetchTransactions.mockResolvedValue({ rows: [], next: null });
  await expect(tool.run({})).resolves.toEqual({ rows: [], next: null });
  expect(fetchTransactions).toHaveBeenCalledWith({}, null);
});

test("transactions_list rejects an invalid filter at the input schema", () => {
  expect(tool.input!.safeParse({ filters: { kind: "bogus" } }).success).toBe(false);
  expect(tool.input!.safeParse({ filters: { categoryId: "not-a-uuid" } }).success).toBe(false);
  expect(tool.input!.safeParse({ filters: { kind: "income" } }).success).toBe(true);
});

const base = { loanPrincipalMinor: null, loanFeeMinor: null, toBalanceId: null, toAmountMinor: null, items: [], settlement: null };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const runRows = async () => ((await tool.run({})) as { rows: Row[] }).rows;

test("transactions_list formats a cash settlement: each tender and change line in its own currency", async () => {
  fetchTransactions.mockResolvedValue({ rows: [{
    ...base, id: "t1", kind: "expense", amountMinor: 340000, currency: "LBP", balanceId: "b-usd",
    settlement: {
      tenderMinor: 500, tenderCurrency: "USD",
      extraTenders: [{ balanceId: "b-lbp", amountMinor: 50000, currency: "LBP" }],
      changes: [{ balanceId: "b-lbp", amountMinor: 110000, currency: "LBP" }, { balanceId: "b-usd", amountMinor: 25, currency: "USD" }],
    },
  }], next: null });
  const [row] = await runRows();
  expect(row.amount).toEqual({ minor: 340000, currency: "LBP", text: "LBP 340,000" });
  expect(row.settlement.tenderMinor).toBe(500);
  expect(row.settlement.tender).toEqual({ minor: 500, currency: "USD", text: "$5.00" });
  expect(row.settlement.extraTenders[0]).toMatchObject({ amountMinor: 50000, amount: { minor: 50000, currency: "LBP", text: "LBP 50,000" } });
  expect(row.settlement.changes[0]).toMatchObject({ amountMinor: 110000, amount: { currency: "LBP", text: "LBP 110,000" } });
  expect(row.settlement.changes[1]).toMatchObject({ amountMinor: 25, amount: { currency: "USD", text: "$0.25" } });
});

test("transactions_list formats item lines in the purchase cost currency", async () => {
  fetchTransactions.mockResolvedValue({ rows: [{
    ...base, id: "t1", kind: "expense", amountMinor: 5000, currency: "USD",
    items: [{ id: "i1", description: "Phone credits", amountMinor: 2000, position: 0 }],
  }], next: null });
  const [row] = await runRows();
  expect(row.items[0]).toMatchObject({ amountMinor: 2000, amount: { minor: 2000, currency: "USD", text: "$20.00" } });
});

test("transactions_list formats what arrived in a transfer in the destination balance's currency", async () => {
  fetchTransactions.mockResolvedValue({ rows: [
    { ...base, id: "t1", kind: "transfer", amountMinor: 10000, currency: "USD", balanceId: "b-usd", toBalanceId: "b-lbp", toAmountMinor: 895000000 },
    { ...base, id: "t2", kind: "transfer", amountMinor: 10000, currency: "USD", balanceId: "b-usd", toBalanceId: "b-gone", toAmountMinor: 7 },
  ], next: null });
  const [known, unknown] = await runRows();
  expect(getWallets).toHaveBeenCalledWith(ALL);
  expect(known.toAmountMinor).toBe(895000000);
  expect(known.toAmount).toEqual({ minor: 895000000, currency: "LBP", text: "LBP 895,000,000" });
  // An unresolved destination stays raw rather than risk a figure in the wrong currency.
  expect(unknown.toAmountMinor).toBe(7);
  expect(unknown).not.toHaveProperty("toAmount");
});

test("transactions_list says which currency each amount is in", () => {
  expect(tool.description).toMatch(/cost currency/i);
  expect(tool.description).toMatch(/settlement/);
  expect(tool.description).toMatch(/toAmount/);
});

// ---- write tools ----

const named = (name: string) => {
  const found = transactionTools.find((item) => item.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
};
const txn = (over: Row = {}): Row => ({
  ...base, id: T1, kind: "expense", occurredOn: "2026-11-20", amountMinor: 450, currency: "USD", balanceId: B_USD, categoryId: CAT,
  note: null, createdAt: "2026-11-20T10:00:00Z", revision: 1, source: null, fixedExpenseId: null, installmentId: null,
  loanId: null, loanFlow: null, loanEvent: null, loanEventSeq: null, ...over,
});
type Written = { transaction: Row; balances: unknown };

test("every write tool has the right kind, a description naming its id source, and a JSON-Schema input", () => {
  expect(Object.fromEntries(transactionTools.map((item) => [item.name, item.kind]))).toEqual({
    transactions_list: "read", transactions_create: "write", transactions_update: "write", transactions_delete: "destructive", transactions_restore: "write",
  });
  for (const item of transactionTools.slice(1)) {
    expect(() => z.toJSONSchema(item.input!, { io: "input" })).not.toThrow();
    expect(item.description).toMatch(/transactions_list|wallets_list/);
  }
  expect(named("transactions_create").description).toMatch(/minor units/);
  expect(named("transactions_create").description).toMatch(/settlement/);
});

describe("transactions_create", () => {
  const create = (args: Row) => named("transactions_create").run(args) as Promise<Written>;

  test("an expense goes through createTransaction with the native draft id and the balance's units, then returns the row and balances", async () => {
    actions.createTransaction.mockResolvedValue({ ok: true, id: T1, revision: 1 });
    const items = [{ description: "Bread", amountMinor: 200 }];
    fetchTransactions.mockResolvedValue({ rows: [txn({ note: "Lunch", items: [{ id: "i1", ...items[0], position: 0 }] })], next: null });
    const out = await create({ kind: "expense", requestId: REQ, balanceId: B_USD, amountMinor: 450, categoryId: CAT, occurredOn: "2026-11-20", note: "Lunch", items });
    expect(actions.createTransaction).toHaveBeenCalledWith(
      { expectedUnits: { USD: 2 }, kind: "expense", occurredOn: "2026-11-20", balanceId: B_USD, amountMinor: 450, categoryId: CAT, items, note: "Lunch" },
      REQ,
    );
    expect(fetchTransactions).toHaveBeenCalledWith({ balanceId: B_USD, from: "2026-11-20", to: "2026-11-20" }, null, 200);
    expect(out.transaction).toMatchObject({ id: T1, revision: 1, amount: { minor: 450, currency: "USD", text: "$4.50" } });
    expect(out.transaction.items[0].amount).toEqual({ minor: 200, currency: "USD", text: "$2.00" });
    expect(balancesOut).toHaveBeenCalledWith([B_USD]);
    expect(out.balances).toBe(BALANCES);
  });

  test("without a requestId a fresh draft id is generated; the date defaults to today in the person's timezone", async () => {
    actions.createTransaction.mockResolvedValue({ ok: true, id: T1, revision: 1 });
    fetchTransactions.mockResolvedValue({ rows: [txn({ kind: "income" })], next: null });
    getProfile.mockResolvedValue({ timezone: "Pacific/Kiritimati" });
    await create({ kind: "income", balanceId: B_LBP, amountMinor: 900000, categoryId: CAT });
    const [input, draftId] = actions.createTransaction.mock.calls[0];
    expect(input).toEqual({ expectedUnits: { LBP: 0 }, kind: "income", occurredOn: todayIn("Pacific/Kiritimati"), balanceId: B_LBP, amountMinor: 900000, categoryId: CAT });
    expect(z.uuid().safeParse(draftId).success).toBe(true);
  });

  test("a retry with the same requestId sends the same draft id; the database's replay returns the first transaction", async () => {
    // save_transaction answers an identical replay with the existing { id, revision } instead of inserting.
    actions.createTransaction.mockResolvedValue({ ok: true, id: T1, revision: 1 });
    fetchTransactions.mockResolvedValue({ rows: [txn()], next: null });
    const args = { kind: "expense", requestId: REQ, balanceId: B_USD, amountMinor: 450, categoryId: CAT, occurredOn: "2026-11-20" };
    const first = await create(args);
    const again = await create(args);
    expect(actions.createTransaction.mock.calls[1]).toEqual(actions.createTransaction.mock.calls[0]);
    expect(again.transaction.id).toBe(first.transaction.id);
  });

  test("a requestId reused for a different transaction gets a clear sentence; other refusals keep theirs", async () => {
    const args = { kind: "expense", balanceId: B_USD, amountMinor: 450, categoryId: CAT, occurredOn: "2026-11-20" };
    actions.createTransaction.mockResolvedValue({ ok: false, error: "conflict" });
    await expect(create({ ...args, requestId: REQ })).rejects.toThrow(/requestId was already used for a different transaction/);
    await expect(create(args)).rejects.toThrow(ACTION_ERROR_TEXT.conflict);
    actions.createTransaction.mockResolvedValue({ ok: false, error: "categoryUnavailable" });
    await expect(create(args)).rejects.toThrow(ACTION_ERROR_TEXT.categoryUnavailable);
    actions.createTransaction.mockResolvedValue({ ok: false, error: "failed" });
    await expect(create(args)).rejects.toBeInstanceOf(ToolError);
    await expect(create(args)).rejects.toThrow(ACTION_ERROR_TEXT.failed);
  });

  test("a cost currency other than the balance's is refused before any write; an unknown balance too", async () => {
    await expect(create({ kind: "expense", balanceId: B_USD, amountMinor: 450, categoryId: CAT, costCurrency: "LBP" })).rejects.toThrow(/cash settlement/);
    await expect(create({ kind: "expense", balanceId: T1, amountMinor: 450, categoryId: CAT })).rejects.toThrow(/wallets_list/);
    expect(actions.createTransaction).not.toHaveBeenCalled();
  });

  test("a same-currency transfer goes through createTransfer with receivedMinor = sentMinor and the native requestId", async () => {
    actions.createTransfer.mockResolvedValue({ ok: true, id: T1, revision: 1 });
    fetchTransactions.mockResolvedValue({ rows: [txn({ kind: "transfer", categoryId: null, toBalanceId: B2_USD, toAmountMinor: 500, amountMinor: 500 })], next: null });
    const out = await create({ kind: "transfer", requestId: REQ, sourceBalanceId: B_USD, destinationBalanceId: B2_USD, sentMinor: 500, occurredOn: "2026-11-20" });
    expect(actions.createTransfer).toHaveBeenCalledWith({
      requestId: REQ, expectedUnits: { USD: 2 }, occurredOn: "2026-11-20", sourceBalanceId: B_USD, destinationBalanceId: B2_USD, sentMinor: 500, receivedMinor: 500,
    });
    expect(fetchTransactions).toHaveBeenCalledWith({ kind: "transfer", balanceId: B_USD, from: "2026-11-20", to: "2026-11-20" }, null, 200);
    expect(out.transaction.toAmount).toEqual({ minor: 500, currency: "USD", text: "$5.00" });
    expect(balancesOut).toHaveBeenCalledWith([B_USD, B2_USD]);
  });

  test("an exchange sends both currencies' units, the actual received amount and an optional USD-LBP rate", async () => {
    actions.createTransfer.mockResolvedValue({ ok: true, id: T1, revision: 1 });
    fetchTransactions.mockResolvedValue({ rows: [txn({ kind: "transfer", toBalanceId: B_LBP, toAmountMinor: 8950000 })], next: null });
    await create({ kind: "transfer", sourceBalanceId: B_USD, destinationBalanceId: B_LBP, sentMinor: 10000, receivedMinor: 8950000, rate: 89500, note: "Exchange", occurredOn: "2026-11-20" });
    const [input] = actions.createTransfer.mock.calls[0];
    expect(input).toMatchObject({ expectedUnits: { USD: 2, LBP: 0 }, sentMinor: 10000, receivedMinor: 8950000, rate: 89500, note: "Exchange" });
    expect(z.uuid().safeParse(input.requestId).success).toBe(true);
  });

  test("transfer amount rules are checked before any write", async () => {
    const run = (args: Row) => create({ kind: "transfer", sourceBalanceId: B_USD, occurredOn: "2026-11-20", ...args });
    await expect(run({ destinationBalanceId: B_LBP, sentMinor: 100 })).rejects.toThrow(/give receivedMinor/);
    await expect(run({ destinationBalanceId: B2_USD, sentMinor: 100, receivedMinor: 90 })).rejects.toThrow(/must equal sentMinor/);
    await expect(run({ destinationBalanceId: B_SYP, sentMinor: 100, receivedMinor: 1300000, rate: 13000 })).rejects.toThrow(/USD and LBP/);
    expect(actions.createTransfer).not.toHaveBeenCalled();
  });

  test("a row that cannot be read after the write is a fixed sentence", async () => {
    actions.createTransaction.mockResolvedValue({ ok: true, id: T1, revision: 1 });
    fetchTransactions.mockResolvedValue({ rows: [], next: null });
    await expect(create({ kind: "expense", balanceId: B_USD, amountMinor: 1, categoryId: CAT, occurredOn: "2026-11-20" })).rejects.toThrow(/was saved, but the transaction cannot be read/);
  });

  test("the input schema is strict and checks each kind's fields", () => {
    const input = named("transactions_create").input!;
    const expense = { kind: "expense", balanceId: B_USD, amountMinor: 450, categoryId: CAT };
    const transfer = { kind: "transfer", sourceBalanceId: B_USD, destinationBalanceId: B2_USD, sentMinor: 100 };
    expect(input.safeParse(expense).success).toBe(true);
    expect(input.safeParse(transfer).success).toBe(true);
    expect(input.safeParse({ ...expense, settlement: { tenderMinor: 500, changes: [] } }).success).toBe(false);
    expect(input.safeParse({ ...expense, categoryId: undefined }).success).toBe(false);
    expect(input.safeParse({ ...expense, amountMinor: 0 }).success).toBe(false);
    expect(input.safeParse({ ...expense, amountMinor: 4.5 }).success).toBe(false);
    expect(input.safeParse({ ...expense, sentMinor: 4 }).success).toBe(false);
    expect(input.safeParse({ ...expense, kind: "income", items: [{ description: "x", amountMinor: 1 }] }).success).toBe(false);
    expect(input.safeParse({ ...expense, items: [{ description: "x", amountMinor: 1, currency: "USD" }] }).success).toBe(false);
    expect(input.safeParse({ ...expense, occurredOn: "1999-12-31" }).success).toBe(false);
    expect(input.safeParse({ ...transfer, balanceId: B_USD }).success).toBe(false);
    expect(input.safeParse({ ...transfer, destinationBalanceId: B_USD }).success).toBe(false);
    expect(input.safeParse({ ...transfer, sentMinor: undefined }).success).toBe(false);
    expect(input.safeParse({ ...expense, kind: "loan" }).success).toBe(false);
  });
});

describe("transactions_update", () => {
  const update = (args: Row) => named("transactions_update").run(args) as Promise<Written>;

  test("a plain expense is saved whole through updateTransaction: unspecified fields come from the current row", async () => {
    fetchTransactions.mockResolvedValue({ rows: [txn({ revision: 3, note: "Kept note" })], next: null });
    actions.updateTransaction.mockResolvedValue({ ok: true, id: T1, revision: 4 });
    const out = await update({ id: T1, revision: 3, amountMinor: 900 });
    expect(fetchTransactions).toHaveBeenNthCalledWith(1, {}, null, 200);
    expect(actions.updateTransaction).toHaveBeenCalledWith(T1, {
      expectedUnits: { USD: 2 }, kind: "expense", occurredOn: "2026-11-20", balanceId: B_USD, amountMinor: 900, categoryId: CAT, note: "Kept note",
    }, 3);
    expect(out.transaction).toMatchObject({ id: T1 });
    expect(balancesOut).toHaveBeenCalledWith([B_USD]);
  });

  test("moving to another balance sends every touched currency's units and reports old and new balances", async () => {
    fetchTransactions.mockResolvedValueOnce({ rows: [txn({ revision: 2 })], next: null })
      .mockResolvedValue({ rows: [txn({ revision: 3, balanceId: B_LBP })], next: null });
    actions.updateTransaction.mockResolvedValue({ ok: true, id: T1, revision: 3 });
    await update({ id: T1, revision: 2, balanceId: B_LBP, note: "", items: [] });
    const [, input] = actions.updateTransaction.mock.calls[0];
    expect(input).toMatchObject({ expectedUnits: { LBP: 0, USD: 2 }, balanceId: B_LBP, note: "", items: [] });
    expect(balancesOut).toHaveBeenCalledWith([B_LBP, B_USD]);
  });

  test("a row with a cash settlement keeps it and sends its leg currencies' units", async () => {
    const settlement = { tenderMinor: 500, tenderCurrency: "USD", changes: [{ balanceId: B_LBP, amountMinor: 1000, currency: "LBP" }] };
    fetchTransactions.mockResolvedValue({ rows: [txn({ settlement })], next: null });
    actions.updateTransaction.mockResolvedValue({ ok: true, id: T1, revision: 2 });
    await update({ id: T1, revision: 1, categoryId: CAT });
    const [, input] = actions.updateTransaction.mock.calls[0];
    expect(input.expectedUnits).toEqual({ USD: 2, LBP: 0 });
    expect(input).not.toHaveProperty("settlement");
  });

  test("finds the row on a later page", async () => {
    fetchTransactions.mockResolvedValueOnce({ rows: [txn({ id: "other" })], next })
      .mockResolvedValue({ rows: [txn()], next: null });
    actions.updateTransaction.mockResolvedValue({ ok: true, id: T1, revision: 2 });
    await update({ id: T1, revision: 1, note: "x" });
    expect(fetchTransactions).toHaveBeenNthCalledWith(2, {}, next, 200);
  });

  test("transfers and managed rows change only their date, through correctTransactionDate", async () => {
    fetchTransactions.mockResolvedValue({ rows: [txn({ kind: "transfer", revision: 2, toBalanceId: B2_USD, toAmountMinor: 450 })], next: null });
    actions.correctTransactionDate.mockResolvedValue({ ok: true, id: T1, revision: 3 });
    await update({ id: T1, revision: 2, occurredOn: "2026-11-01" });
    expect(actions.correctTransactionDate).toHaveBeenCalledWith(T1, 2, "2026-11-01");
    expect(actions.updateTransaction).not.toHaveBeenCalled();
    await expect(update({ id: T1, revision: 2, amountMinor: 5 })).rejects.toThrow(/Only the date/);
    fetchTransactions.mockResolvedValue({ rows: [txn({ source: "salary" })], next: null });
    await expect(update({ id: T1, revision: 1, occurredOn: "2026-11-01", note: "x" })).rejects.toThrow(/Only the date/);
    expect(actions.correctTransactionDate).toHaveBeenCalledTimes(1);
  });

  test("a stale revision, an unknown id and an action error are fixed sentences", async () => {
    fetchTransactions.mockResolvedValue({ rows: [txn({ revision: 5 })], next: null });
    await expect(update({ id: T1, revision: 4, note: "x" })).rejects.toThrow(ACTION_ERROR_TEXT.conflict);
    expect(actions.updateTransaction).not.toHaveBeenCalled();
    await expect(update({ id: "99999999-9999-4999-8999-999999999999", revision: 1, note: "x" })).rejects.toThrow(/does not exist or was deleted/);
    actions.updateTransaction.mockResolvedValue({ ok: false, error: "breakdownExceedsTotal" });
    await expect(update({ id: T1, revision: 5, amountMinor: 1 })).rejects.toThrow(ACTION_ERROR_TEXT.breakdownExceedsTotal);
  });

  test("the input schema needs a change and is strict", () => {
    const input = named("transactions_update").input!;
    expect(input.safeParse({ id: T1, revision: 1 }).success).toBe(false);
    expect(input.safeParse({ id: T1, revision: 1, note: "x" }).success).toBe(true);
    expect(input.safeParse({ id: T1, revision: 0, note: "x" }).success).toBe(false);
    expect(input.safeParse({ id: T1, revision: 1, kind: "income" }).success).toBe(false);
    expect(input.safeParse({ id: T1, revision: 1, amountMinor: -1 }).success).toBe(false);
    expect(input.safeParse({ id: T1, revision: 1, settlement: null }).success).toBe(false);
  });
});

describe("transactions_delete and transactions_restore", () => {
  test("delete calls deleteTransaction and returns the new revision and the touched balances", async () => {
    fetchTransactions.mockResolvedValue({ rows: [txn({ revision: 3 })], next: null });
    actions.deleteTransaction.mockResolvedValue({ ok: true, id: T1, revision: 4 });
    await expect(named("transactions_delete").run({ id: T1, revision: 3 })).resolves.toEqual({ deleted: true, id: T1, revision: 4, balances: BALANCES });
    expect(actions.deleteTransaction).toHaveBeenCalledWith(T1, 3);
    expect(balancesOut).toHaveBeenCalledWith([B_USD]);
  });

  test("delete refusals are fixed sentences", async () => {
    fetchTransactions.mockResolvedValue({ rows: [], next: null });
    actions.deleteTransaction.mockResolvedValue({ ok: false, error: "managedTransaction" });
    await expect(named("transactions_delete").run({ id: T1, revision: 3 })).rejects.toThrow(ACTION_ERROR_TEXT.managedTransaction);
  });

  test("restore calls restoreTransaction and returns the row and balances", async () => {
    actions.restoreTransaction.mockResolvedValue({ ok: true, id: T1, revision: 5 });
    fetchTransactions.mockResolvedValue({ rows: [txn({ revision: 5 })], next: null });
    const out = (await named("transactions_restore").run({ id: T1, revision: 4 })) as Written;
    expect(actions.restoreTransaction).toHaveBeenCalledWith(T1, 4);
    expect(out.transaction).toMatchObject({ id: T1, revision: 5 });
    expect(out.balances).toBe(BALANCES);
    actions.restoreTransaction.mockResolvedValue({ ok: false, error: "conflict" });
    await expect(named("transactions_restore").run({ id: T1, revision: 4 })).rejects.toThrow(ACTION_ERROR_TEXT.conflict);
  });

  test("their input schemas are strict", () => {
    for (const name of ["transactions_delete", "transactions_restore"]) {
      const input = named(name).input!;
      expect(input.safeParse({ id: T1, revision: 1 }).success).toBe(true);
      expect(input.safeParse({ id: T1 }).success).toBe(false);
      expect(input.safeParse({ id: "t1", revision: 1 }).success).toBe(false);
      expect(input.safeParse({ id: T1, revision: 1, force: true }).success).toBe(false);
    }
  });
});
