import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ configured: true, error: false, jobs: [] as Record<string, unknown>[], receipts: [] as Record<string, unknown>[], ranges: [] as number[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: () => state.configured }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const chain = { select: () => chain, is: () => chain, not: () => chain, order: () => chain,
    range: async (from: number, to: number) => {
      state.ranges.push(from);
      return { data: (table === "pending_payment_progress" ? state.jobs : state.receipts).slice(from, to + 1), error: state.error ? { message: "failed" } : null };
    } };
  return chain;
} }) }));
import { getPendingPayments } from "./queries";
const job = { id: "job", client: "Client", project: "Website", currency: "USD", total_minor: "10000", received_minor: "2500", remaining_minor: "7500", due_on: null, revision: 1, has_receipt_history: true };
const receipt = { id: "receipt", pending_payment_id: "job", amount_minor: "2500", occurred_on: "2026-01-01", wallet_id: "wallet" };
beforeEach(() => { state.configured = true; state.error = false; state.jobs = [{ ...job }]; state.receipts = [{ ...receipt }]; state.ranges = []; });
describe("pending payment reads", () => {
  it("reads exact money and preserves history eligibility after live receipts are deleted", async () => {
    state.receipts = [];
    const [result] = await getPendingPayments();
    expect(result.totalMinor).toBe(10000);
    expect(result.hasReceiptHistory).toBe(true);
    expect(result.receipts).toEqual([]);
  });
  it("reads past PostgREST row limits for both jobs and receipts", async () => {
    state.jobs = Array.from({ length: 1001 }, (_, index) => ({ ...job, id: `job-${index}` }));
    state.receipts = Array.from({ length: 1001 }, (_, index) => ({ ...receipt, id: `receipt-${index}`, pending_payment_id: `job-${index}` }));
    const results = await getPendingPayments();
    expect(results).toHaveLength(1001);
    expect(results[1000].receipts[0].id).toBe("receipt-1000");
    expect(state.ranges.filter((from) => from >= 1000)).toHaveLength(2);
  });
  it("fails visibly on query errors, unknown currencies and unsafe amounts", async () => {
    state.error = true;
    await expect(getPendingPayments()).rejects.toThrow();
    state.error = false;
    state.jobs = [{ ...job, currency: "EUR" }];
    await expect(getPendingPayments()).rejects.toThrow();
    state.jobs = [{ ...job, total_minor: "1000000000000001" }];
    await expect(getPendingPayments()).rejects.toThrow();
  });
});
