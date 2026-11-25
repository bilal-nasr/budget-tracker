import { beforeEach, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));
const getPendingPayments = vi.fn();
const getPendingReceipts = vi.fn();
const getCurrencies = vi.fn();
vi.mock("./queries", () => ({
  getPendingPayments: () => getPendingPayments(),
  getPendingReceipts: (...args: unknown[]) => getPendingReceipts(...args),
}));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
const getWallets = vi.fn();
const getProfile = vi.fn();
const createPendingPayment = vi.fn();
const updatePendingPayment = vi.fn();
const deletePendingPayment = vi.fn();
const recordPendingReceipt = vi.fn();
vi.mock("@/features/wallets/queries", () => ({ getWallets: (...args: unknown[]) => getWallets(...args) }));
vi.mock("@/features/profile/queries", () => ({ getProfile: () => getProfile() }));
vi.mock("./actions", () => ({
  createPendingPayment: (...args: unknown[]) => createPendingPayment(...args),
  updatePendingPayment: (...args: unknown[]) => updatePendingPayment(...args),
  deletePendingPayment: (...args: unknown[]) => deletePendingPayment(...args),
  recordPendingReceipt: (...args: unknown[]) => recordPendingReceipt(...args),
}));
import { ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT } from "@/lib/mcp/write";
import { pendingPaymentTools } from "./mcp";

const tool = (name: string) => pendingPaymentTools.find((t) => t.name === name)!;
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const job = { id: JOB_ID, client: "Acme", project: "Site", currency: "USD", totalMinor: 60000, receivedMinor: 20000, remainingMinor: 40000, dueOn: null, revision: 1, hasReceiptHistory: true };

const BAL = "33333333-3333-4333-8333-333333333333";
const CAT = "55555555-5555-4555-8555-555555555555";
const REQ = "66666666-6666-4666-8666-666666666666";
const wallets = [{
  id: "w1", name: "Bank", kind: "bank", position: 0, deleted: false, needsAttention: false, defaultBalanceId: BAL,
  balances: [{ id: BAL, walletId: "w1", currency: "USD", openingBalanceMinor: 0, balanceMinor: 40000, position: 0, detached: false }],
}];

beforeEach(() => {
  vi.resetAllMocks();
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
  getWallets.mockResolvedValue(wallets);
  getProfile.mockResolvedValue({ timezone: "Asia/Beirut" });
});

test("pending_payments_list adds total, received and remaining", async () => {
  getPendingPayments.mockResolvedValue([job]);
  expect(tool("pending_payments_list").kind).toBe("read");
  const out = (await tool("pending_payments_list").run({})) as { payments: Record<string, unknown>[] };
  expect(out.payments[0]).toMatchObject({
    totalMinor: 60000, total: { minor: 60000, currency: "USD", text: "$600.00" },
    received: { text: "$200.00" }, remaining: { minor: 40000, text: "$400.00" },
  });
});

test("pending_payments_receipts rejects a non-uuid id and formats receipts in the job's currency", async () => {
  const input = tool("pending_payments_receipts").input!;
  expect(input.safeParse({ paymentId: "nope" }).success).toBe(false);
  expect(input.safeParse({ paymentId: JOB_ID }).success).toBe(true);
  getPendingPayments.mockResolvedValue([job]);
  getPendingReceipts.mockResolvedValue([{ id: "r1", amountMinor: 20000, occurredOn: "2026-11-01", balanceId: "b1" }]);
  const out = (await tool("pending_payments_receipts").run({ paymentId: JOB_ID })) as { receipts: Record<string, unknown>[] };
  expect(getPendingReceipts).toHaveBeenCalledWith(JOB_ID);
  expect(out.receipts[0]).toMatchObject({ amountMinor: 20000, amount: { minor: 20000, currency: "USD", text: "$200.00" } });
});

test("receipts stay raw when the job is not in the list", async () => {
  getPendingPayments.mockResolvedValue([]);
  const receipt = { id: "r1", amountMinor: 20000, occurredOn: "2026-11-01", balanceId: "b1" };
  getPendingReceipts.mockResolvedValue([receipt]);
  const out = (await tool("pending_payments_receipts").run({ paymentId: JOB_ID })) as { receipts: unknown[] };
  expect(out.receipts[0]).toEqual(receipt);
});

// ---- write tools ----

test("write tools come after the read tools and have the right kinds", () => {
  expect(pendingPaymentTools.slice(0, 2).map((t) => t.name)).toEqual(["pending_payments_list", "pending_payments_receipts"]);
  expect(tool("pending_payments_create").kind).toBe("write");
  expect(tool("pending_payments_update").kind).toBe("write");
  expect(tool("pending_payments_record_receipt").kind).toBe("write");
  expect(tool("pending_payments_delete").kind).toBe("destructive");
});

test("pending_payments_create maps the input with the currency intent and returns the job", async () => {
  createPendingPayment.mockResolvedValue({ ok: true, id: JOB_ID });
  getPendingPayments.mockResolvedValue([job]);
  const out = (await tool("pending_payments_create").run({ requestId: REQ, client: "Acme", project: "Site", currency: "USD", totalMinor: 60000, dueOn: "2026-12-31" })) as { payment: Record<string, unknown> };
  expect(createPendingPayment).toHaveBeenCalledWith({
    expectedUnits: { USD: 2 }, requestId: REQ, client: "Acme", project: "Site", currency: "USD", totalMinor: 60000, dueOn: "2026-12-31",
  });
  expect(out.payment).toMatchObject({ id: JOB_ID, total: { minor: 60000, text: "$600.00" }, remaining: { minor: 40000 } });
  expect(out).not.toHaveProperty("balances");
});

test("pending_payments_create generates a requestId, defaults dueOn to null and replays a retry", async () => {
  createPendingPayment.mockResolvedValue({ ok: true, id: JOB_ID });
  getPendingPayments.mockResolvedValue([job]);
  await tool("pending_payments_create").run({ client: "Acme", project: "Site", currency: "LBP", totalMinor: 5 });
  expect(createPendingPayment.mock.calls[0][0]).toMatchObject({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), dueOn: null });
  const input = { requestId: REQ, client: "Acme", project: "Site", currency: "USD", totalMinor: 60000 };
  const first = await tool("pending_payments_create").run(input);
  await expect(tool("pending_payments_create").run(input)).resolves.toEqual(first);
  expect(createPendingPayment.mock.calls[2][0]).toEqual(createPendingPayment.mock.calls[1][0]);
});

test("pending_payments_create input normalizes the currency through the parsed input", () => {
  const parsed = tool("pending_payments_create").input!.safeParse({ client: "A", project: "B", currency: " lbp ", totalMinor: 5 });
  expect(parsed.success && parsed.data.currency).toBe("LBP");
});

test("pending_payments_create maps errors and refuses an unknown or disabled currency", async () => {
  createPendingPayment.mockResolvedValue({ ok: false, error: "conflict" });
  await expect(tool("pending_payments_create").run({ requestId: REQ, client: "A", project: "B", currency: "USD", totalMinor: 1 }))
    .rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.conflict });
  createPendingPayment.mockClear();
  await expect(tool("pending_payments_create").run({ client: "A", project: "B", currency: "EUR", totalMinor: 1 }))
    .rejects.toMatchObject({ message: ACTION_ERROR_TEXT.currencyUnavailable });
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS.map((c) => (c.code === "SYP" ? { ...c, disabled: true } : c)));
  await expect(tool("pending_payments_create").run({ client: "A", project: "B", currency: "SYP", totalMinor: 1 }))
    .rejects.toMatchObject({ message: ACTION_ERROR_TEXT.currencyDisabled });
  expect(createPendingPayment).not.toHaveBeenCalled();
});

test("pending_payments_create input is strict and validates", () => {
  const input = tool("pending_payments_create").input!;
  const ok = { client: "A", project: "B", currency: "USD", totalMinor: 1 };
  expect(input.safeParse(ok).success).toBe(true);
  expect(input.safeParse({ ...ok, receivedMinor: 0 }).success).toBe(false);
  expect(input.safeParse({ ...ok, totalMinor: 0 }).success).toBe(false);
  expect(input.safeParse({ ...ok, totalMinor: 2.5 }).success).toBe(false);
  expect(input.safeParse({ ...ok, client: " " }).success).toBe(false);
  expect(input.safeParse({ ...ok, dueOn: "tomorrow" }).success).toBe(false);
  expect(input.safeParse({ ...ok, requestId: "nope" }).success).toBe(false);
});

test("pending_payments_update merges the current job, keeps its currency and passes the revision", async () => {
  getPendingPayments.mockResolvedValue([job]);
  updatePendingPayment.mockResolvedValue({ ok: true });
  const out = (await tool("pending_payments_update").run({ id: JOB_ID, revision: 1, totalMinor: 70000, dueOn: null })) as { payment: Record<string, unknown> };
  expect(updatePendingPayment).toHaveBeenCalledWith(JOB_ID, 1, {
    expectedUnits: { USD: 2 }, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), client: "Acme", project: "Site", currency: "USD", totalMinor: 70000, dueOn: null,
  });
  expect(out.payment).toMatchObject({ id: JOB_ID });
});

test("pending_payments_update maps errors and refuses an unknown job", async () => {
  getPendingPayments.mockResolvedValue([job]);
  updatePendingPayment.mockResolvedValue({ ok: false, error: "totalBelowPaid" });
  await expect(tool("pending_payments_update").run({ id: JOB_ID, revision: 1, totalMinor: 1 }))
    .rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.totalBelowPaid });
  getPendingPayments.mockResolvedValue([]);
  await expect(tool("pending_payments_update").run({ id: JOB_ID, revision: 1 })).rejects.toBeInstanceOf(ToolError);
});

test("pending_payments_update input is strict and requires the revision", () => {
  const input = tool("pending_payments_update").input!;
  expect(input.safeParse({ id: JOB_ID, revision: 1 }).success).toBe(true);
  expect(input.safeParse({ id: JOB_ID }).success).toBe(false);
  expect(input.safeParse({ id: JOB_ID, revision: 1, currency: "LBP" }).success).toBe(false);
  expect(input.safeParse({ id: JOB_ID, revision: -1 }).success).toBe(false);
});

test("pending_payments_delete passes id and revision and explains a job with receipts", async () => {
  getPendingPayments.mockResolvedValue([job]);
  deletePendingPayment.mockResolvedValue({ ok: true });
  await expect(tool("pending_payments_delete").run({ id: JOB_ID, revision: 1 })).resolves.toEqual({ deleted: true, id: JOB_ID });
  expect(deletePendingPayment).toHaveBeenCalledWith(JOB_ID, 1);
  deletePendingPayment.mockResolvedValue({ ok: false, error: "inUse" });
  await expect(tool("pending_payments_delete").run({ id: JOB_ID, revision: 1 })).rejects.toMatchObject({ name: "ToolError", message: expect.stringMatching(/received money/) });
  deletePendingPayment.mockResolvedValue({ ok: false, error: "conflict" });
  await expect(tool("pending_payments_delete").run({ id: JOB_ID, revision: 1 })).rejects.toMatchObject({ message: ACTION_ERROR_TEXT.conflict });
  expect(tool("pending_payments_delete").input!.safeParse({ id: JOB_ID, revision: 1, all: true }).success).toBe(false);
});

test("pending_payments_record_receipt maps the input and returns the job, the receipt and balances", async () => {
  getPendingPayments.mockResolvedValue([job]);
  recordPendingReceipt.mockResolvedValue({ ok: true, id: REQ });
  getPendingReceipts.mockResolvedValue([{ id: REQ, amountMinor: 40000, occurredOn: "2026-11-25", balanceId: BAL }]);
  const out = (await tool("pending_payments_record_receipt").run({ requestId: REQ, paymentId: JOB_ID, balanceId: BAL, categoryId: CAT, amountMinor: 40000, occurredOn: "2026-11-25" })) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(recordPendingReceipt).toHaveBeenCalledWith({
    expectedUnits: { USD: 2 }, requestId: REQ, paymentId: JOB_ID, balanceId: BAL, categoryId: CAT, amountMinor: 40000, occurredOn: "2026-11-25",
  });
  expect(out.receipt).toMatchObject({ id: REQ, amount: { minor: 40000, currency: "USD", text: "$400.00" } });
  expect(out.payment).toMatchObject({ id: JOB_ID });
  expect(out.balances[0].balances[0]).toMatchObject({ id: BAL, amount: { minor: 40000 } });
  expect(tool("pending_payments_record_receipt").description).toMatch(/remainingMinor/);
});

test("pending_payments_record_receipt generates a requestId and date, replays and maps errors", async () => {
  getPendingPayments.mockResolvedValue([job]);
  recordPendingReceipt.mockImplementation(async (input: { requestId: string }) => ({ ok: true, id: input.requestId }));
  getPendingReceipts.mockResolvedValue([]);
  const out = (await tool("pending_payments_record_receipt").run({ paymentId: JOB_ID, balanceId: BAL, categoryId: CAT, amountMinor: 1 })) as Record<string, unknown>;
  expect(recordPendingReceipt.mock.calls[0][0]).toMatchObject({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), occurredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  expect(out.receipt).toBeNull();
  const input = { requestId: REQ, paymentId: JOB_ID, balanceId: BAL, categoryId: CAT, amountMinor: 1, occurredOn: "2026-11-25" };
  const first = await tool("pending_payments_record_receipt").run(input);
  await expect(tool("pending_payments_record_receipt").run(input)).resolves.toEqual(first);
  recordPendingReceipt.mockResolvedValue({ ok: false, error: "exceedsRemaining" });
  await expect(tool("pending_payments_record_receipt").run(input)).rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.exceedsRemaining });
  recordPendingReceipt.mockResolvedValue({ ok: false, error: "walletUnavailable" });
  await expect(tool("pending_payments_record_receipt").run(input)).rejects.toMatchObject({ message: ACTION_ERROR_TEXT.walletUnavailable });
});

test("pending_payments_record_receipt input is strict and validates", () => {
  const input = tool("pending_payments_record_receipt").input!;
  const ok = { paymentId: JOB_ID, balanceId: BAL, categoryId: CAT, amountMinor: 1 };
  expect(input.safeParse(ok).success).toBe(true);
  expect(input.safeParse({ ...ok, full: true }).success).toBe(false);
  expect(input.safeParse({ ...ok, amountMinor: 0 }).success).toBe(false);
  expect(input.safeParse({ ...ok, categoryId: "x" }).success).toBe(false);
  expect(input.safeParse({ ...ok, occurredOn: "2026-13-01" }).success).toBe(false);
});
