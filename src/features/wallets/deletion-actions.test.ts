import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), from: vi.fn(), wallets: vi.fn(), currencies: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/action", async (original) => ({ ...await original<typeof import("@/lib/supabase/action")>(), actionClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("./queries", () => ({ getWallets: mocks.wallets }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: mocks.currencies }));
import { inspectWalletDeletion, settleAndDeleteWallet } from "./actions";
const owner = "aaaaaaaa-0000-4000-8000-000000000001";
const id = "aaaaaaaa-0000-4000-8000-000000000002";
const balanceId = "aaaaaaaa-0000-4000-8000-000000000003";
const counterpartBalanceId = "aaaaaaaa-0000-4000-8000-000000000004";
let reads: Record<string, Record<string, unknown>[]>;
beforeEach(() => {
  vi.clearAllMocks();
  reads = { profiles: [], fixed_expenses: [], installments: [], installment_progress: [], loan_progress: [] };
  mocks.from.mockImplementation((table) => {
    let key = "id", after: string | null = null, limit = 1000;
    const filters: Array<[string, string[]]> = [];
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      in: vi.fn((field: string, values: string[]) => { filters.push([field, values]); return query; }),
      order: vi.fn((field: string) => { key = field; return query; }),
      gt: vi.fn((_field: string, value: string) => { after = value; return query; }),
      limit: vi.fn((value: number) => { limit = Math.min(value, 1000); return query; }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: reads[table].filter((row) => filters.every(([field, values]) => values.includes(String(row[field]))) && (after === null || String(row[key]) > after)).sort((a, b) => String(a[key]).localeCompare(String(b[key]))).slice(0, limit), error: null }).then(resolve),
    }; return query;
  });
  mocks.client.mockResolvedValue({ userId: owner, supabase: { rpc: mocks.rpc, from: mocks.from } });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.currencies.mockResolvedValue([{ code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true }]);
  mocks.wallets.mockResolvedValue([{ id, name: "Pocket", kind: "cash", position: 0, deleted: false, needsAttention: false, defaultBalanceId: balanceId, balances: [{ id: balanceId, walletId: id, currency: "USD", balanceMinor: 0, openingBalanceMinor: 0, position: 0, detached: false }] }]);
});
it("inspects the exact dependency contract including zero wallet balances", async () => {
  reads.profiles = [{ salary_balance_id: balanceId }];
  reads.fixed_expenses = [{ id: "rent", name: "Rent", balance_id: balanceId }];
  reads.installments = [{ id: "open", name: "Open", balance_id: balanceId }, { id: "paid", name: "Paid", balance_id: balanceId }];
  reads.installment_progress = [{ installment_id: "open", remaining_minor: "1" }, { installment_id: "paid", remaining_minor: "0" }];
  reads.loan_progress = [{ id: "loan", name: "Loan", balance_id: balanceId, remaining_minor: "5", deleted_at: null }, { id: "deleted", balance_id: balanceId, remaining_minor: "5", deleted_at: "date" }];
  const result = await inspectWalletDeletion(id);
  expect(result).toMatchObject({ ok: true, plan: { walletId: id, lines: [], blockers: [
    { kind: "salary", balanceId }, { kind: "fixedExpense", id: "rent", balanceId }, { kind: "installment", id: "open", balanceId }, { kind: "loan", id: "loan", balanceId },
  ] } });
  expect(mocks.wallets).toHaveBeenCalledWith({ includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true });
  for (const call of mocks.from.mock.results) expect(call.value.eq).toHaveBeenCalledWith("user_id", owner);
});
it("does not guess missing dependency progress or expose private inspection errors", async () => {
  reads.installments = [{ id: "open", balance_id: balanceId }];
  expect(await inspectWalletDeletion(id)).toEqual({ ok: false, error: "failed" });
  mocks.wallets.mockRejectedValueOnce(new Error("private detail"));
  expect(await inspectWalletDeletion(id)).toEqual({ ok: false, error: "failed" });
});
it("submits the whole settlement only once per attempt and keeps the retry token/payload exact", async () => {
  const settlements = [{ balanceId, counterpartBalanceId, expectedAmountMinor: 5, expectedUnit: { code: "USD", decimalPlaces: 2 } }];
  mocks.rpc.mockRejectedValueOnce(new Error("ambiguous network outcome"));
  expect(await settleAndDeleteWallet(owner, id, settlements)).toEqual({ ok: false, error: "failed" });
  expect(mocks.revalidate).not.toHaveBeenCalled();
  expect(await settleAndDeleteWallet(owner, id, settlements)).toEqual({ ok: true });
  expect(mocks.rpc.mock.calls).toEqual(Array(2).fill(["settle_and_delete_wallet", { p_request_id: owner, p_wallet_id: id, p_settlements: settlements }]));
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.revalidate).toHaveBeenCalledOnce();
});
it("finds every source dependency beyond the API cap, including independently paged installment progress", async () => {
  for (let n = 0; n < 1205; n++) {
    const key = `row-${String(n).padStart(5, "0")}`;
    reads.fixed_expenses.push({ id: key, name: key, balance_id: balanceId });
    reads.installments.push({ id: key, name: key, balance_id: balanceId });
    reads.installment_progress.push({ installment_id: key, remaining_minor: "1" });
    reads.loan_progress.push({ id: key, name: key, balance_id: balanceId, remaining_minor: "1", deleted_at: null });
  }
  reads.fixed_expenses.push({ id: "unrelated", name: "Other wallet", balance_id: counterpartBalanceId });
  const result = await inspectWalletDeletion(id);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.plan.blockers).toHaveLength(3615);
  expect(result.plan.blockers).toContainEqual({ kind: "fixedExpense", id: "row-01204", name: "row-01204", balanceId });
  expect(result.plan.blockers).toContainEqual({ kind: "installment", id: "row-01204", name: "row-01204", balanceId });
  expect(result.plan.blockers).toContainEqual({ kind: "loan", id: "row-01204", name: "row-01204", balanceId });
  for (const [index, [table]] of mocks.from.mock.calls.entries()) {
    if (["fixed_expenses", "installments", "loan_progress"].includes(table)) expect(mocks.from.mock.results[index].value.in).toHaveBeenCalledWith("balance_id", [balanceId]);
  }
});
it.each(["wallet.inUse", "wallet.invalidSettlement", "wallet.deleted", "wallet.deletionConflict", "wallet.needsAttention"])("returns atomic RPC rejection %s without partial writes or invalidation", async (message) => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message } });
  expect((await settleAndDeleteWallet(owner, id, [{ balanceId, counterpartBalanceId, expectedAmountMinor: 5, expectedUnit: { code: "USD", decimalPlaces: 2 } }])).ok).toBe(false);
  expect(mocks.rpc).toHaveBeenCalledOnce();
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("validates strict settlement entries before authentication and uses atomic deletion even for zero", async () => {
  expect(await settleAndDeleteWallet(owner, id, [{ balanceId, counterpartBalanceId, amountMinor: 3 } as never])).toEqual({ ok: false, error: "invalid" });
  expect(await settleAndDeleteWallet(owner, id, [{ balanceId, counterpartBalanceId: balanceId, expectedAmountMinor: 5, expectedUnit: { code: "USD", decimalPlaces: 2 } }])).toEqual({ ok: false, error: "invalid" });
  expect(await settleAndDeleteWallet(owner, id, [{ balanceId, counterpartBalanceId, expectedAmountMinor: 5, expectedUnit: { code: "USD", decimalPlaces: 2 } }, { balanceId, counterpartBalanceId, expectedAmountMinor: 5, expectedUnit: { code: "USD", decimalPlaces: 2 } }])).toEqual({ ok: false, error: "invalid" });
  expect(await inspectWalletDeletion("bad")).toEqual({ ok: false, error: "invalid" });
  expect(mocks.client).not.toHaveBeenCalled();
  expect(await settleAndDeleteWallet(owner, id, [])).toEqual({ ok: true });
});
it("preserves preview and authentication failures", async () => {
  mocks.client.mockResolvedValueOnce({ error: "notConfigured" });
  expect(await inspectWalletDeletion(id)).toEqual({ ok: false, error: "notConfigured" });
  mocks.client.mockRejectedValueOnce(new Error("private"));
  expect(await settleAndDeleteWallet(owner, id, [])).toEqual({ ok: false, error: "failed" });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
