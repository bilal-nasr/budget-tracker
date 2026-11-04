import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ createClient: vi.fn(), configured: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mock.createClient }));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: mock.configured }));
import { fetchTransactions } from "./queries";
import { emptySettlementRow } from "./settlement-serialization";

let query: Record<string, ReturnType<typeof vi.fn>>;
const row = (n: number) => ({
  ...emptySettlementRow(),
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, kind: "expense", occurred_on: "2026-11-04",
  amount_minor: "5000", currency: "USD", wallet_id: "wallet", category_id: "category", to_wallet_id: null,
  to_amount_minor: null, note: "Sister", created_at: `2026-11-04T12:00:0${n}Z`, revision: 7,
  source: null, fixed_expense_id: null, installment_id: null, loan_id: null, loan_flow: null,
  expense_items: [
    { id: "two", description: "For sister", amount_minor: "3000", position: 1 },
    { id: "one", description: "Phone credits", amount_minor: "2000", position: 0 },
  ],
});
beforeEach(() => {
  vi.clearAllMocks();
  mock.configured.mockReturnValue(true);
  query = Object.fromEntries(["select", "is", "order", "limit", "eq", "gte", "lte", "ilike", "or", "in"].map((key) => [key, vi.fn().mockReturnThis()]));
  query.then = vi.fn((resolve) => Promise.resolve({ data: [row(1), row(2)], error: null }).then(resolve));
  mock.from.mockReturnValue(query);
  mock.createClient.mockResolvedValue({ from: mock.from });
});
describe("complete transaction reads", () => {
  it("embeds ordered item arrays without multiplying parent rows or changing pagination", async () => {
    const page = await fetchTransactions({}, null, 1);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ note: "Sister", revision: 7, source: null, amountMinor: 5000, items: [
      { id: "one", position: 0, description: "Phone credits", amountMinor: 2000 },
      { id: "two", position: 1, description: "For sister", amountMinor: 3000 },
    ] });
    expect(page.next).toEqual({ occurredOn: "2026-11-04", createdAt: row(1).created_at, id: row(1).id });
    expect(query.select.mock.calls[0][0]).toContain("expense_items!expense_items_transaction_owner_fkey");
    expect(mock.from).toHaveBeenCalledTimes(1);
  });
  it("returns empty item arrays for unitemized and transfer parents and preserves source links", async () => {
    query.then.mockImplementation((resolve) => Promise.resolve({ data: [
      { ...row(1), expense_items: null, source: "installment", installment_id: "plan" },
      { ...row(2), kind: "transfer", category_id: null, expense_items: [] },
    ], error: null }).then(resolve));
    const page = await fetchTransactions({}, null);
    expect(page.rows.map((item) => item.items)).toEqual([[], []]);
    expect(page.rows[0].installmentId).toBe("plan");
  });
  it("reads settlement cost and exact change without multiplying its parent", async () => {
    query.then.mockImplementation((resolve) => Promise.resolve({ data: [{ ...row(1), amount_minor: "1250",
      tender_minor: "2000", change_wallet_id: "aaaaaaaa-0000-4000-8000-000000000001", change_minor: "671250", change_currency: "LBP",
      change_rate_base: "USD", change_rate_quote: "LBP", change_rate_numerator: "89500", change_rate_denominator: "1",
    }], error: null }).then(resolve));
    const result = await fetchTransactions({}, null);
    expect(result.rows[0]).toMatchObject({ amountMinor: 1250, settlement: { tenderMinor: 2000, change: { amountMinor: 671250, currency: "LBP" } } });
    expect(result.rows).toHaveLength(1);
  });
  it("ANDs source/destination/change wallet membership with the keyset cursor", async () => {
    const walletId = "aaaaaaaa-0000-4000-8000-000000000001";
    await fetchTransactions({ walletId }, { occurredOn: "2026-11-04", createdAt: "2026-11-04T12:00:01Z", id: row(1).id });
    expect(query.eq).not.toHaveBeenCalledWith("wallet_id", walletId);
    expect(query.or).toHaveBeenCalledOnce();
    expect(query.or.mock.calls[0][0]).toContain(`and(or(wallet_id.eq.${walletId},to_wallet_id.eq.${walletId},change_wallet_id.eq.${walletId}),or(occurred_on.lt.`);
  });
  it("demo receiving-wallet membership includes one purchase with its cost, not tender", async () => {
    mock.configured.mockReturnValue(false);
    const page = await fetchTransactions({ walletId: "00000000-0000-4000-8000-000000000003", q: "Coffee" }, null);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ amountMinor: 350, kind: "expense", settlement: { tenderMinor: 1000, change: { amountMinor: 581750 } } });
  });
});
