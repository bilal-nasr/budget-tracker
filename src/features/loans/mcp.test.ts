import { beforeEach, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));
const getLoans = vi.fn();
const getLoanHistory = vi.fn();
const getCurrencies = vi.fn();
const getWallets = vi.fn();
const getProfile = vi.fn();
const createLoan = vi.fn();
const updateLoan = vi.fn();
const deleteLoan = vi.fn();
const recordLoanPayment = vi.fn();
const voidLoanPayment = vi.fn();
const deleteLoanPayment = vi.fn();
vi.mock("./queries", () => ({
  getLoans: () => getLoans(),
  getLoanHistory: (...args: unknown[]) => getLoanHistory(...args),
}));
vi.mock("./actions", () => ({
  createLoan: (...args: unknown[]) => createLoan(...args),
  updateLoan: (...args: unknown[]) => updateLoan(...args),
  deleteLoan: (...args: unknown[]) => deleteLoan(...args),
  recordLoanPayment: (...args: unknown[]) => recordLoanPayment(...args),
  voidLoanPayment: (...args: unknown[]) => voidLoanPayment(...args),
  deleteLoanPayment: (...args: unknown[]) => deleteLoanPayment(...args),
}));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
vi.mock("@/features/wallets/queries", () => ({ getWallets: (...args: unknown[]) => getWallets(...args) }));
vi.mock("@/features/profile/queries", () => ({ getProfile: () => getProfile() }));
import { ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT } from "@/lib/mcp/write";
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

const BAL = "33333333-3333-4333-8333-333333333333";
const LBP_BAL = "44444444-4444-4444-8444-444444444444";
const CAT = "55555555-5555-4555-8555-555555555555";
const REQ = "66666666-6666-4666-8666-666666666666";
const TX = "77777777-7777-4777-8777-777777777777";
const wallets = [{
  id: "w1", name: "Cash", kind: "cash", position: 0, deleted: false, needsAttention: false, defaultBalanceId: BAL,
  balances: [
    { id: BAL, walletId: "w1", currency: "USD", openingBalanceMinor: 0, balanceMinor: 5000, position: 0, detached: false },
    { id: LBP_BAL, walletId: "w1", currency: "LBP", openingBalanceMinor: 0, balanceMinor: 900000, position: 1, detached: false },
  ],
}];
const repayment = (overrides: Record<string, unknown> = {}) => ({
  transactionId: TX, revision: 1, loanId: LOAN_ID, event: "repayment", flow: "out", sequence: 2, balanceId: BAL, occurredOn: "2026-11-20",
  amountMinor: 21000, principalMinor: 21000, feeMinor: 0, categoryId: CAT, deletedAt: null, ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
  getWallets.mockResolvedValue(wallets);
  getProfile.mockResolvedValue({ timezone: "Asia/Beirut" });
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

// ---- write tools ----

const createInput = { name: "Car", direction: "borrowed", principalMinor: 100000, feeBps: 500, balanceId: BAL, feeCategoryId: CAT };

test("write tools come after the read tools and have the right kinds", () => {
  expect(loanTools.slice(0, 2).map((t) => t.name)).toEqual(["loans_list", "loans_history"]);
  expect(tool("loans_create").kind).toBe("write");
  expect(tool("loans_update").kind).toBe("write");
  expect(tool("loans_record_payment").kind).toBe("write");
  expect(tool("loans_delete").kind).toBe("destructive");
  expect(tool("loans_delete_payment").kind).toBe("destructive");
});

test("loans_create maps the input, builds the currency intent from the balance and returns the loan and balances", async () => {
  createLoan.mockResolvedValue({ ok: true, id: LOAN_ID });
  getLoans.mockResolvedValue([loan({ balanceId: BAL })]);
  const out = (await tool("loans_create").run({ ...createInput, requestId: REQ, openedOn: "2026-10-01" })) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(createLoan).toHaveBeenCalledWith({
    ...createInput, expectedUnits: { USD: 2 }, requestId: REQ, openedOn: "2026-10-01", creationMode: "new", principalPaidBeforeMinor: 0, feePaidBeforeMinor: 0,
  });
  expect(out.loan).toMatchObject({ id: LOAN_ID, principal: { minor: 100000, currency: "USD", text: "$1,000.00" } });
  expect(out.loan).not.toHaveProperty("events");
  expect(out.balances).toHaveLength(1);
  expect(out.balances[0].balances[0]).toMatchObject({ id: BAL, amount: { minor: 5000, currency: "USD" } });
});

test("loans_create generates a requestId and today's date when absent; an existing loan moves no money", async () => {
  createLoan.mockResolvedValue({ ok: true, id: LOAN_ID });
  getLoans.mockResolvedValue([loan({ creationMode: "existing" })]);
  const out = (await tool("loans_create").run({ ...createInput, balanceId: LBP_BAL, creationMode: "existing", principalPaidBeforeMinor: 100 })) as Record<string, unknown>;
  const sent = createLoan.mock.calls[0][0];
  expect(sent.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(sent.openedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(sent.expectedUnits).toEqual({ LBP: 0 });
  expect(sent).toMatchObject({ creationMode: "existing", principalPaidBeforeMinor: 100, feePaidBeforeMinor: 0 });
  expect(out).not.toHaveProperty("balances");
});

test("loans_create with a reused requestId returns the existing loan (the database replays it)", async () => {
  createLoan.mockResolvedValue({ ok: true, id: LOAN_ID });
  getLoans.mockResolvedValue([loan()]);
  const input = { ...createInput, requestId: REQ, openedOn: "2026-10-01" };
  const first = await tool("loans_create").run(input);
  const second = await tool("loans_create").run(input);
  expect(second).toEqual(first);
  expect(createLoan.mock.calls[1][0]).toEqual(createLoan.mock.calls[0][0]);
});

test("loans_create turns an action error into the fixed sentence and refuses an unknown balance", async () => {
  createLoan.mockResolvedValue({ ok: false, error: "invalid" });
  await expect(tool("loans_create").run({ ...createInput, requestId: REQ })).rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.invalid });
  createLoan.mockResolvedValue({ ok: false, error: "failed" });
  await expect(tool("loans_create").run({ ...createInput, requestId: REQ })).rejects.toMatchObject({ message: ACTION_ERROR_TEXT.failed });
  createLoan.mockClear();
  await expect(tool("loans_create").run({ ...createInput, balanceId: CAT })).rejects.toMatchObject({ message: ACTION_ERROR_TEXT.walletUnavailable });
  expect(createLoan).not.toHaveBeenCalled();
});

test("loans_create input is strict and validates", () => {
  const input = tool("loans_create").input!;
  expect(input.safeParse(createInput).success).toBe(true);
  expect(input.safeParse({ ...createInput, extra: 1 }).success).toBe(false);
  expect(input.safeParse({ ...createInput, expectedUnits: { USD: 2 } }).success).toBe(false);
  expect(input.safeParse({ ...createInput, principalMinor: 1.5 }).success).toBe(false);
  expect(input.safeParse({ ...createInput, principalMinor: 0 }).success).toBe(false);
  expect(input.safeParse({ ...createInput, feeBps: 10001 }).success).toBe(false);
  expect(input.safeParse({ ...createInput, direction: "given" }).success).toBe(false);
  expect(input.safeParse({ ...createInput, openedOn: "2026-02-30" }).success).toBe(false);
  expect(input.safeParse({ ...createInput, requestId: "nope" }).success).toBe(false);
  expect(input.safeParse({ ...createInput, name: "" }).success).toBe(false);
});

test("loans_update merges the current loan, builds the intent and returns the loan", async () => {
  getLoans.mockResolvedValue([loan({ balanceId: BAL })]);
  updateLoan.mockResolvedValue({ ok: true });
  const out = (await tool("loans_update").run({ id: LOAN_ID, name: "Truck", monthlyPaymentMinor: null, paymentCount: null })) as { loan: Record<string, unknown> };
  expect(updateLoan).toHaveBeenCalledWith(LOAN_ID, {
    expectedUnits: { USD: 2 }, name: "Truck", balanceId: BAL, feeCategoryId: "c1", monthlyPaymentMinor: null, paymentCount: null,
  });
  expect(out.loan).toMatchObject({ id: LOAN_ID, remaining: { minor: 84000 } });
  expect(out).not.toHaveProperty("balances");
});

test("loans_update leaves the plan out when not given and maps errors", async () => {
  getLoans.mockResolvedValue([loan({ balanceId: BAL })]);
  updateLoan.mockResolvedValue({ ok: true });
  await tool("loans_update").run({ id: LOAN_ID, feeCategoryId: CAT });
  expect(updateLoan.mock.calls[0][1]).toEqual({ expectedUnits: { USD: 2 }, name: "Car", balanceId: BAL, feeCategoryId: CAT });
  updateLoan.mockResolvedValue({ ok: false, error: "termsLocked" });
  await expect(tool("loans_update").run({ id: LOAN_ID, name: "X" })).rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.termsLocked });
  getLoans.mockResolvedValue([]);
  await expect(tool("loans_update").run({ id: LOAN_ID, name: "X" })).rejects.toBeInstanceOf(ToolError);
});

test("loans_update input is strict", () => {
  const input = tool("loans_update").input!;
  expect(input.safeParse({ id: LOAN_ID }).success).toBe(true);
  expect(input.safeParse({ id: LOAN_ID, principalMinor: 5 }).success).toBe(false);
  expect(input.safeParse({ id: "nope" }).success).toBe(false);
  expect(input.safeParse({ id: LOAN_ID, paymentCount: 0 }).success).toBe(false);
});

test("loans_delete removes the loan and returns the balances its live entries moved", async () => {
  getLoans.mockResolvedValue([loan({ archivedAt: "2026-11-01T00:00:00Z" })]);
  getLoanHistory.mockResolvedValueOnce({ rows: [repayment(), repayment({ transactionId: "t2", balanceId: LBP_BAL, deletedAt: "x" })], next: 1 })
    .mockResolvedValueOnce({ rows: [repayment({ transactionId: "t0", event: "disbursement", sequence: 0 })], next: null });
  deleteLoan.mockResolvedValue({ ok: true });
  const out = (await tool("loans_delete").run({ id: LOAN_ID })) as { deleted: boolean; id: string; balances: unknown[] };
  expect(deleteLoan).toHaveBeenCalledWith(LOAN_ID);
  expect(getLoanHistory).toHaveBeenNthCalledWith(2, LOAN_ID, 1);
  expect(out).toMatchObject({ deleted: true, id: LOAN_ID });
  expect(getWallets).toHaveBeenLastCalledWith({ includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true });
  expect(out.balances).toHaveLength(1);
});

test("loans_delete explains an active loan and maps other errors", async () => {
  getLoans.mockResolvedValue([loan()]);
  getLoanHistory.mockResolvedValue({ rows: [], next: null });
  deleteLoan.mockResolvedValue({ ok: false, error: "inUse" });
  await expect(tool("loans_delete").run({ id: LOAN_ID })).rejects.toMatchObject({ name: "ToolError", message: expect.stringMatching(/archived .* or canceled/) });
  deleteLoan.mockResolvedValue({ ok: false, error: "conflict" });
  await expect(tool("loans_delete").run({ id: LOAN_ID })).rejects.toMatchObject({ message: ACTION_ERROR_TEXT.conflict });
  const out = await (deleteLoan.mockResolvedValue({ ok: true }), tool("loans_delete").run({ id: LOAN_ID }));
  expect(out).toEqual({ deleted: true, id: LOAN_ID });
  expect(tool("loans_delete").input!.safeParse({ id: LOAN_ID, force: true }).success).toBe(false);
  expect(tool("loans_delete").description).toMatch(/cannot be undone/);
});

test("loans_record_payment maps the input and returns the loan, the payment and balances", async () => {
  recordLoanPayment.mockResolvedValue({ ok: true, id: TX, revision: 1 });
  getLoans.mockResolvedValue([loan()]);
  getLoanHistory.mockResolvedValue({ rows: [repayment()], next: null });
  const out = (await tool("loans_record_payment").run({ requestId: REQ, loanId: LOAN_ID, balanceId: BAL, amountMinor: 21000, occurredOn: "2026-11-20" })) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(recordLoanPayment).toHaveBeenCalledWith({ expectedUnits: { USD: 2 }, requestId: REQ, loanId: LOAN_ID, balanceId: BAL, amountMinor: 21000, occurredOn: "2026-11-20" });
  expect(out.payment).toMatchObject({ transactionId: TX, revision: 1, amount: { minor: 21000, currency: "USD" }, principal: { minor: 21000 } });
  expect(out.loan).toMatchObject({ id: LOAN_ID });
  expect(out.balances[0].id).toBe("w1");
});

test("loans_record_payment generates a requestId and date, replays and maps errors", async () => {
  recordLoanPayment.mockResolvedValue({ ok: true, id: TX, revision: 1 });
  getLoans.mockResolvedValue([loan()]);
  getLoanHistory.mockResolvedValue({ rows: [repayment()], next: null });
  await tool("loans_record_payment").run({ loanId: LOAN_ID, balanceId: BAL, amountMinor: 1 });
  expect(recordLoanPayment.mock.calls[0][0].requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(recordLoanPayment.mock.calls[0][0].occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const input = { requestId: REQ, loanId: LOAN_ID, balanceId: BAL, amountMinor: 21000, occurredOn: "2026-11-20" };
  const first = await tool("loans_record_payment").run(input);
  await expect(tool("loans_record_payment").run(input)).resolves.toEqual(first);
  recordLoanPayment.mockResolvedValue({ ok: false, error: "exceedsRemaining" });
  await expect(tool("loans_record_payment").run(input)).rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.exceedsRemaining });
});

test("loans_record_payment input is strict and validates", () => {
  const input = tool("loans_record_payment").input!;
  const ok = { loanId: LOAN_ID, balanceId: BAL, amountMinor: 100 };
  expect(input.safeParse(ok).success).toBe(true);
  expect(input.safeParse({ ...ok, note: "x" }).success).toBe(false);
  expect(input.safeParse({ ...ok, amountMinor: 0 }).success).toBe(false);
  expect(input.safeParse({ ...ok, amountMinor: 1.5 }).success).toBe(false);
  expect(input.safeParse({ ...ok, occurredOn: "20-11-2026" }).success).toBe(false);
});

test("loans_delete_payment voids (not deletes) the payment with the given revision and returns what undo needs", async () => {
  getLoanHistory.mockResolvedValueOnce({ rows: [repayment({ revision: 3 })], next: null })
    .mockResolvedValue({ rows: [repayment({ revision: 4, deletedAt: "2026-11-25T00:00:00Z" })], next: null });
  voidLoanPayment.mockResolvedValue({ ok: true, id: TX, revision: 4 });
  getLoans.mockResolvedValue([loan()]);
  const out = (await tool("loans_delete_payment").run({ loanId: LOAN_ID, transactionId: TX, revision: 3 })) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(voidLoanPayment).toHaveBeenCalledWith(TX, 3);
  expect(deleteLoanPayment).not.toHaveBeenCalled();
  expect(out).toMatchObject({ deleted: true, voided: true, id: TX, revision: 4, payment: { revision: 4, deletedAt: "2026-11-25T00:00:00Z" }, loan: { id: LOAN_ID } });
  expect(out.balances).toHaveLength(1);
});

test("loans_delete_payment refuses a payment outside the loan or a disbursement and maps errors", async () => {
  getLoanHistory.mockResolvedValue({ rows: [], next: null });
  await expect(tool("loans_delete_payment").run({ loanId: LOAN_ID, transactionId: TX, revision: 1 })).rejects.toBeInstanceOf(ToolError);
  getLoanHistory.mockResolvedValue({ rows: [repayment({ event: "disbursement" })], next: null });
  await expect(tool("loans_delete_payment").run({ loanId: LOAN_ID, transactionId: TX, revision: 1 })).rejects.toBeInstanceOf(ToolError);
  expect(voidLoanPayment).not.toHaveBeenCalled();
  getLoanHistory.mockResolvedValue({ rows: [repayment()], next: null });
  voidLoanPayment.mockResolvedValue({ ok: false, error: "paymentOrder" });
  await expect(tool("loans_delete_payment").run({ loanId: LOAN_ID, transactionId: TX, revision: 1 })).rejects.toMatchObject({ message: ACTION_ERROR_TEXT.paymentOrder });
  voidLoanPayment.mockResolvedValue({ ok: false, error: "conflict" });
  await expect(tool("loans_delete_payment").run({ loanId: LOAN_ID, transactionId: TX, revision: 1 })).rejects.toMatchObject({ message: ACTION_ERROR_TEXT.conflict });
});

test("loans_delete_payment input is strict and requires the revision", () => {
  const input = tool("loans_delete_payment").input!;
  expect(input.safeParse({ loanId: LOAN_ID, transactionId: TX, revision: 1 }).success).toBe(true);
  expect(input.safeParse({ loanId: LOAN_ID, transactionId: TX }).success).toBe(false);
  expect(input.safeParse({ loanId: LOAN_ID, transactionId: TX, revision: 0 }).success).toBe(false);
  expect(input.safeParse({ loanId: LOAN_ID, transactionId: TX, revision: 1, hard: true }).success).toBe(false);
});
