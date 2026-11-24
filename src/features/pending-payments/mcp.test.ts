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
import { pendingPaymentTools } from "./mcp";

const tool = (name: string) => pendingPaymentTools.find((t) => t.name === name)!;
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const job = { id: JOB_ID, client: "Acme", project: "Site", currency: "USD", totalMinor: 60000, receivedMinor: 20000, remainingMinor: 40000, dueOn: null, revision: 1, hasReceiptHistory: true };

beforeEach(() => {
  vi.resetAllMocks();
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
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
