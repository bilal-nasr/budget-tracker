import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ configured: true, error: false, items: [] as Record<string, unknown>[], events: [] as Record<string, unknown>[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: () => state.configured }));
vi.mock("./demo", () => ({ demoLoans: () => [{ id: "synthetic-demo" }] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const chain = { select: () => chain, eq: () => chain, order: () => chain, range: async (from: number, to: number) => ({ data: (table === "loan_progress" ? state.items : state.events).slice(from, to + 1), error: state.error ? { code: "syntheticFailure" } : null }) };
  return chain;
} }) }));
import { getLoans } from "./queries";
const row = {
  id: "loan-a", name: "Synthetic", direction: "borrowed", currency: "USD", wallet_id: "wallet", fee_category_id: "category",
  opened_on: "2026-01-01", creation_mode: "existing", principal_minor: "100000", fee_bps: 725, fee_minor: "7250", total_due_minor: "107250",
  principal_paid_before_minor: 40000, fee_paid_before_minor: 0, principal_paid_minor: 40000, fee_paid_minor: 0,
  principal_remaining_minor: 60000, fee_remaining_minor: 7250, remaining_minor: 67250, archived_at: null, deleted_at: null,
};
beforeEach(() => { state.configured = true; state.error = false; state.items = [{ ...row }]; state.events = []; });
describe("loan query decoding", () => {
  it("derives the final payment from the original total, including fee, rather than the paid-down balance", async () => {
    state.items = [{ ...row, monthly_payment_minor: "30000", payment_count: 3 }];
    expect((await getLoans())[0]).toMatchObject({ monthlyPaymentMinor: 30000, paymentCount: 3, finalPaymentMinor: 47250 });
    for (const plan of [{ monthly_payment_minor: "30000", payment_count: null }, { monthly_payment_minor: "30000", payment_count: 5 }, { monthly_payment_minor: null, payment_count: 2 }]) {
      state.items = [{ ...row, ...plan }];
      await expect(getLoans()).rejects.toThrow("loansUnavailable");
    }
  });
  it("decodes exact SQL strings and retains voided event revision/history", async () => {
    state.events = [{ id: "pay", revision: 3, loan_id: "loan-a", loan_event: "repayment", loan_flow: "out", loan_event_seq: 1,
      wallet_id: "wallet", occurred_on: "2026-01-02", amount_minor: "100", loan_principal_minor: "100", loan_fee_minor: "0", category_id: "category", deleted_at: "2026-01-03T00:00:00Z" }];
    const [item] = await getLoans();
    expect(item.totalDueMinor).toBe(107250);
    expect(item.events[0]).toMatchObject({ transactionId: "pay", revision: 3, principalMinor: 100, feeMinor: 0, deletedAt: "2026-01-03T00:00:00Z" });
  });
  it("fails visibly for query errors and unsupported numeric/currency values", async () => {
    state.error = true;
    await expect(getLoans()).rejects.toThrow("loansUnavailable");
    state.error = false;
    state.items = [{ ...row, total_due_minor: "9007199254740993" }];
    await expect(getLoans()).rejects.toThrow("loansUnavailable");
    state.items = [{ ...row, currency: "INVALID" }];
    await expect(getLoans()).rejects.toThrow("loansUnavailable");
  });
  it("uses clearly synthetic data without a configured backend", async () => {
    state.configured = false;
    expect(await getLoans()).toEqual([{ id: "synthetic-demo" }]);
  });
  it("reads beyond the 1000-row API boundary for both loans and global payment history", async () => {
    state.items = Array.from({ length: 1001 }, (_, n) => ({ ...row, id: `loan-${n}` }));
    state.events = Array.from({ length: 1101 }, (_, n) => ({ id: `payment-${n}`, revision: 1, loan_id: "loan-1000", loan_event: "repayment", loan_flow: "out", loan_event_seq: n + 1,
      wallet_id: "wallet", occurred_on: "2026-01-02", amount_minor: "10", loan_principal_minor: "10", loan_fee_minor: "0", category_id: "category", deleted_at: null }));
    const loans = await getLoans();
    expect(loans).toHaveLength(1001);
    expect(loans[1000].events).toHaveLength(1101);
    expect(loans[1000].events.at(-1)?.transactionId).toBe("payment-1100");
  });
});
