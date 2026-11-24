import { beforeEach, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));
const fetchTransactions = vi.fn();
const getCurrencies = vi.fn();
const getWallets = vi.fn();
vi.mock("@/features/wallets/queries", () => ({ getWallets: (...args: unknown[]) => getWallets(...args) }));
vi.mock("./queries", () => ({ fetchTransactions: (...args: unknown[]) => fetchTransactions(...args) }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
import { transactionTools } from "./mcp";

const [tool] = transactionTools;
const next = { occurredOn: "2026-11-01", createdAt: "2026-11-01T10:00:00Z", id: "6f1c3a0e-8a4e-4a53-9b3a-1d0f6a2d7c11" };

beforeEach(() => {
  fetchTransactions.mockReset();
  getCurrencies.mockReset();
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
  getWallets.mockReset();
  getWallets.mockResolvedValue([
    { id: "w1", balances: [{ id: "b-usd", currency: "USD" }, { id: "b-lbp", currency: "LBP" }] },
    { id: "w2", balances: [{ id: "b-syp", currency: "SYP" }] },
  ]);
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
  expect(getWallets).toHaveBeenCalledWith({ includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true });
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
