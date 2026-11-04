import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ configured: true, error: false, jobs: [] as Record<string, unknown>[], receipts: [] as Record<string, unknown>[], ranges: [] as number[], tables: [] as string[], filters: [] as [string, unknown][] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: () => state.configured }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  state.tables.push(table);
  const chain = { select: () => chain, is: () => chain, not: () => chain, order: () => chain,
    eq: (column: string, value: unknown) => { state.filters.push([column, value]); return chain; },
    range: async (from: number, to: number) => {
      state.ranges.push(from);
      return { data: (table === "pending_payment_progress" ? state.jobs : state.receipts).slice(from, to + 1), error: state.error ? { message: "failed" } : null };
    } };
  return chain;
} }) }));
import { getPendingPayments, getPendingReceipts } from "./queries";
const job = { id: "job", client: "Client", project: "Website", currency: "USD", total_minor: "10000", received_minor: "2500", remaining_minor: "7500", due_on: null, revision: 1, has_receipt_history: true };
const receipt = { id: "receipt", pending_payment_id: "job", amount_minor: "2500", occurred_on: "2026-01-01", wallet_id: "wallet" };
beforeEach(() => { state.configured = true; state.error = false; state.jobs = [{ ...job }]; state.receipts = [{ ...receipt }]; state.ranges = []; state.tables = []; state.filters = []; });
describe("pending payment reads", () => {
  it("reads exact money and preserves history eligibility after live receipts are deleted", async () => {
    state.jobs = [{ ...job, received_minor: "0", remaining_minor: "10000" }];
    const [result] = await getPendingPayments();
    expect(result.totalMinor).toBe(10000);
    expect(result.receivedMinor).toBe(0);
    expect(result.hasReceiptHistory).toBe(true);
  });
  it("reads job summaries without downloading receipt history", async () => {
    await getPendingPayments();
    expect(state.tables).toEqual(["pending_payment_progress"]);
  });
  it("reads past PostgREST row limits for jobs", async () => {
    state.jobs = Array.from({ length: 1001 }, (_, index) => ({ ...job, id: `job-${index}` }));
    const results = await getPendingPayments();
    expect(results).toHaveLength(1001);
    expect(state.ranges.filter((from) => from >= 1000)).toHaveLength(1);
  });
  it("reads one job's receipts on demand, past PostgREST row limits", async () => {
    state.receipts = Array.from({ length: 1001 }, (_, index) => ({ ...receipt, id: `receipt-${index}` }));
    const receipts = await getPendingReceipts("job");
    expect(state.tables.every((table) => table === "transactions")).toBe(true);
    expect(state.filters).toContainEqual(["pending_payment_id", "job"]);
    expect(receipts).toHaveLength(1001);
    expect(receipts[0]).toEqual({ id: "receipt-0", amountMinor: 2500, occurredOn: "2026-01-01", walletId: "wallet" });
  });
  it("fails visibly on query errors, unknown currencies and unsafe amounts", async () => {
    state.error = true;
    await expect(getPendingPayments()).rejects.toThrow();
    await expect(getPendingReceipts("job")).rejects.toThrow();
    state.error = false;
    state.jobs = [{ ...job, currency: "EUR" }];
    await expect(getPendingPayments()).rejects.toThrow();
    state.jobs = [{ ...job, total_minor: "1000000000000001" }];
    await expect(getPendingPayments()).rejects.toThrow();
    state.receipts = [{ ...receipt, amount_minor: "1000000000000001" }];
    await expect(getPendingReceipts("job")).rejects.toThrow();
  });
});
