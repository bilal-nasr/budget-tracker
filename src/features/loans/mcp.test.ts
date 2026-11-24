import { beforeEach, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));
const getLoans = vi.fn();
const getLoanHistory = vi.fn();
const getCurrencies = vi.fn();
vi.mock("./queries", () => ({
  getLoans: () => getLoans(),
  getLoanHistory: (...args: unknown[]) => getLoanHistory(...args),
}));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
import { loanTools } from "./mcp";

const tool = (name: string) => loanTools.find((t) => t.name === name)!;
const LOAN_ID = "11111111-1111-4111-8111-111111111111";
const loan = (overrides: Record<string, unknown> = {}) => ({
  id: LOAN_ID, name: "Car", direction: "borrowed", currency: "USD", balanceId: "b1", feeCategoryId: "c1", openedOn: "2026-10-01",
  creationMode: "new", principalMinor: 100000, feeBps: 500, feeMinor: 5000, totalDueMinor: 105000, principalPaidBeforeMinor: 0,
  feePaidBeforeMinor: 0, principalPaidMinor: 20000, feePaidMinor: 1000, principalRemainingMinor: 80000, feeRemainingMinor: 4000,
  remainingMinor: 84000, monthlyPaymentMinor: 21000, paymentCount: 5, finalPaymentMinor: 21000, archivedAt: null, deletedAt: null,
  events: [], ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
});

test("loans_list adds an amount beside every minor figure in the loan's currency", async () => {
  getLoans.mockResolvedValue([loan(), loan({ id: "x", currency: "LBP", monthlyPaymentMinor: null, finalPaymentMinor: null, remainingMinor: 500000 })]);
  expect(tool("loans_list").kind).toBe("read");
  const out = (await tool("loans_list").run({})) as { loans: Record<string, any>[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const first = out.loans[0];
  expect(first.principalMinor).toBe(100000);
  expect(first.principal).toEqual({ minor: 100000, currency: "USD", text: "$1,000.00" });
  const pairs: [string, number][] = [
    ["fee", 5000], ["totalDue", 105000], ["principalPaidBefore", 0], ["feePaidBefore", 0], ["principalPaid", 20000], ["feePaid", 1000],
    ["principalRemaining", 80000], ["feeRemaining", 4000], ["remaining", 84000], ["monthlyPayment", 21000], ["finalPayment", 21000],
  ];
  for (const [key, minor] of pairs) expect(first[key]).toMatchObject({ minor, currency: "USD" });
  expect(out.loans[1]).toMatchObject({ monthlyPayment: null, finalPayment: null, remaining: { minor: 500000, currency: "LBP", text: "LBP 500,000" } });
});

test("loans_history validates ids and forwards before (null when absent)", async () => {
  const input = tool("loans_history").input!;
  expect(input.safeParse({ loanId: "nope" }).success).toBe(false);
  expect(input.safeParse({ loanId: LOAN_ID, before: 1.5 }).success).toBe(false);
  expect(input.safeParse({ loanId: LOAN_ID }).success).toBe(true);
  getLoans.mockResolvedValue([loan()]);
  getLoanHistory.mockResolvedValue({ rows: [], next: null });
  await tool("loans_history").run({ loanId: LOAN_ID });
  expect(getLoanHistory).toHaveBeenCalledWith(LOAN_ID, null);
  await tool("loans_history").run({ loanId: LOAN_ID, before: 7 });
  expect(getLoanHistory).toHaveBeenLastCalledWith(LOAN_ID, 7);
});

test("loans_history adds amount, principal and fee in the loan's currency", async () => {
  getLoans.mockResolvedValue([loan({ currency: "LBP" })]);
  getLoanHistory.mockResolvedValue({
    rows: [{ transactionId: "t1", revision: 1, loanId: LOAN_ID, event: "repayment", flow: "out", sequence: 3, balanceId: "b1", occurredOn: "2026-11-01",
      amountMinor: 105000, principalMinor: 100000, feeMinor: 5000, categoryId: null, deletedAt: null }],
    next: 3,
  });
  const out = (await tool("loans_history").run({ loanId: LOAN_ID })) as { rows: Record<string, unknown>[]; next: number };
  expect(out.next).toBe(3);
  expect(out.rows[0]).toMatchObject({
    amountMinor: 105000,
    amount: { minor: 105000, currency: "LBP", text: "LBP 105,000" },
    principal: { minor: 100000, currency: "LBP" },
    fee: { minor: 5000, currency: "LBP" },
  });
});

test("loans_history leaves amounts raw when the loan is not found", async () => {
  getLoans.mockResolvedValue([]);
  const row = { transactionId: "t1", amountMinor: 5, principalMinor: 5, feeMinor: 0 };
  getLoanHistory.mockResolvedValue({ rows: [row], next: null });
  const out = (await tool("loans_history").run({ loanId: LOAN_ID })) as { rows: unknown[] };
  expect(out.rows[0]).toEqual(row);
});

test("the loan descriptions say archived and deleted loans and deleted events are included and flagged", () => {
  const list = tool("loans_list").description;
  expect(list).toMatch(/archivedAt/);
  expect(list).toMatch(/deletedAt/);
  expect(list).toMatch(/archived and deleted loans are included/i);
  const history = tool("loans_history").description;
  expect(history).toMatch(/deletedAt/);
  expect(history).toMatch(/deleted/i);
});

test("loans_list leaves out the never-filled event history and points to loans_history", async () => {
  // What getLoans really returns from the database: no events, flagged incomplete.
  getLoans.mockResolvedValue([loan({ events: [], historyComplete: false, livePaymentCount: 1 })]);
  const out = (await tool("loans_list").run({})) as { loans: Record<string, unknown>[] };
  expect(out.loans[0]).not.toHaveProperty("events");
  expect(out.loans[0]).not.toHaveProperty("historyComplete");
  expect(out.loans[0]).toMatchObject({ id: LOAN_ID, livePaymentCount: 1 });
  expect(tool("loans_list").description).toMatch(/\(its events\) are not listed here; use loans_history/i);
});
