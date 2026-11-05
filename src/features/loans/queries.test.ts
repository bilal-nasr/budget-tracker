import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ configured: true, error: false, items: [] as Record<string, unknown>[], events: [] as Record<string, unknown>[], tables: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: () => state.configured }));
vi.mock("./demo", () => ({ demoLoans: () => [{ id: "synthetic-demo" }] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  state.tables.push(table);
  const chain = { select: () => chain, eq: () => chain, order: () => chain, range: async (from: number, to: number) => ({ data: (table === "loan_progress" || table === "loan_overview" ? state.items : state.events).slice(from, to + 1), error: state.error ? { code: "syntheticFailure" } : null }) };
  return chain;
} }) }));
import { getLoans } from "./queries";
const row = {
  id: "loan-a", name: "Synthetic", direction: "borrowed", currency: "USD", balance_id: "wallet", fee_category_id: "category",
  opened_on: "2026-01-01", creation_mode: "existing", principal_minor: "100000", fee_bps: 725, fee_minor: "7250", total_due_minor: "107250",
  principal_paid_before_minor: 40000, fee_paid_before_minor: 0, principal_paid_minor: 40000, fee_paid_minor: 0,
  principal_remaining_minor: 60000, fee_remaining_minor: 7250, remaining_minor: 67250, archived_at: null, deleted_at: null, live_payment_count: 0, latest_payment_on: null, latest_payment_id: null, latest_payment_revision: null, latest_payment_sequence: null,
};
beforeEach(() => { state.configured = true; state.error = false; state.items = [{ ...row }]; state.events = []; state.tables = []; });
describe("loan query decoding", () => {
  it("derives the final payment from the original total, including fee, rather than the paid-down balance", async () => {
    state.items = [{ ...row, monthly_payment_minor: "30000", payment_count: 3 }];
    expect((await getLoans())[0]).toMatchObject({ monthlyPaymentMinor: 30000, paymentCount: 3, finalPaymentMinor: 47250 });
    for (const plan of [{ monthly_payment_minor: "30000", payment_count: null }, { monthly_payment_minor: "30000", payment_count: 5 }, { monthly_payment_minor: null, payment_count: 2 }]) {
      state.items = [{ ...row, ...plan }];
      await expect(getLoans()).rejects.toThrow("loansUnavailable");
    }
  });
  it("retains payment ordering facts without downloading global history", async () => {
    state.items = [{ ...row, live_payment_count: 50, latest_payment_on: "2026-01-02", latest_payment_id: "payment-50",
      latest_payment_revision: 3, latest_payment_sequence: 50 }];
    const [item] = await getLoans();
    expect(item.totalDueMinor).toBe(107250);
    expect(item.events).toEqual([]);
    expect(item.historyComplete).toBe(false);
    expect(item.latestLivePayment).toEqual({ transactionId: "payment-50", revision: 3, sequence: 50 });
    expect(item.livePaymentCount).toBe(50);
    expect(state.tables).not.toContain("transactions");
  });
  it("fails visibly for query errors and invalid numeric/currency values", async () => {
    state.error = true;
    await expect(getLoans()).rejects.toThrow("loansUnavailable");
    state.error = false;
    state.items = [{ ...row, total_due_minor: "9007199254740993" }];
    await expect(getLoans()).rejects.toThrow("loansUnavailable");
    state.items = [{ ...row, currency: "invalid-code" }];
    await expect(getLoans()).rejects.toThrow("loansUnavailable");
  });
  it("uses clearly synthetic data without a configured backend", async () => {
    state.configured = false;
    expect(await getLoans()).toEqual([{ id: "synthetic-demo" }]);
  });
  it("reads beyond the 1000-row API boundary for summaries without downloading global payment history", async () => {
    state.items = Array.from({ length: 1001 }, (_, n) => ({ ...row, id: `loan-${n}` }));
    state.events = Array.from({ length: 1101 }, (_, n) => ({ id: `payment-${n}`, revision: 1, loan_id: "loan-1000", loan_event: "repayment", loan_flow: "out", loan_event_seq: n + 1,
      balance_id: "wallet", occurred_on: "2026-01-02", amount_minor: "10", loan_principal_minor: "10", loan_fee_minor: "0", category_id: "category", deleted_at: null }));
    const loans = await getLoans();
    expect(loans).toHaveLength(1001);
    expect(loans[1000].events).toHaveLength(0);
    expect(state.tables).not.toContain("transactions");
  });
});

it("retains custom-currency history and exact balance identity without a built-in enum",async()=>{
 state.items=[{...row,currency:"TOKEN8",balance_id:"exact-custom-balance",principal_minor:"123456789"}];
 expect((await getLoans())[0]).toMatchObject({currency:"TOKEN8",balanceId:"exact-custom-balance",principalMinor:123456789});
});
