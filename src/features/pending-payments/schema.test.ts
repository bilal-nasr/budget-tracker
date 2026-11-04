import { describe, expect, it } from "vitest";
import { pendingPaymentSchema, receiptSchema } from "./schema";

const id = "ab000000-0000-4000-8000-000000000001";
const job = { requestId: id, client: "Client", project: "Website", currency: "USD", totalMinor: 10000, dueOn: null };
describe("pending payments", () => {
  it("accepts an undated job and trims names", () => {
    expect(pendingPaymentSchema.parse({ ...job, client: " Client " }).client).toBe("Client");
  });
  it("rejects impossible due dates, empty clients and unsafe totals", () => {
    for (const patch of [{ dueOn: "2026-02-30" }, { client: " " }, { totalMinor: 0 }, { totalMinor: 1.5 }, { totalMinor: 1e16 }])
      expect(pendingPaymentSchema.safeParse({ ...job, ...patch }).success).toBe(false);
  });
  it("validates partial receipt identity, amount, wallet, category and date", () => {
    const receipt = { requestId: id, paymentId: id, walletId: id, categoryId: id, amountMinor: 2500, occurredOn: "2026-11-04" };
    expect(receiptSchema.safeParse(receipt).success).toBe(true);
    for (const patch of [{ amountMinor: 0 }, { walletId: "foreign" }, { categoryId: "" }, { occurredOn: "2026-13-01" }])
      expect(receiptSchema.safeParse({ ...receipt, ...patch }).success).toBe(false);
  });
});
