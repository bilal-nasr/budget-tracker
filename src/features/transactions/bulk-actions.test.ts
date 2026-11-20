import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/action", () => ({ actionClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("server-only", () => ({}));
import { deleteTransactions, restoreTransactions, setTransactionsCategory } from "./bulk-actions";
import { BULK_LIMIT, canBulkDelete, canBulkRecategorize } from "./bulk-schema";
import { emptyTransactionMetadata, type Transaction } from "./schema";

const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const category = "00000000-0000-4000-8000-000000000009";
const items = [{ id: a, revision: 1 }, { id: b, revision: 4 }];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ userId: a, supabase: { rpc: mocks.rpc, from: mocks.from } });
  mocks.rpc.mockResolvedValue({ data: [{ id: a, revision: 2 }, { id: b, revision: 5 }], error: null });
});

describe("bulk transaction actions", () => {
  it("deletes a batch through one RPC and returns the new revisions for Undo", async () => {
    expect(await deleteTransactions(items)).toEqual({ ok: true, items: [{ id: a, revision: 2 }, { id: b, revision: 5 }] });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("set_transactions_deleted", { p_items: items, p_deleted: true });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });

  it("restores a batch with the same RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: b, revision: 6 }, { id: a, revision: 3 }], error: null });
    expect(await restoreTransactions([{ id: a, revision: 2 }, { id: b, revision: 5 }])).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("set_transactions_deleted", { p_items: [{ id: a, revision: 2 }, { id: b, revision: 5 }], p_deleted: false });
  });

  it("rejects empty, repeated, oversized and malformed batches before touching the database", async () => {
    expect(await deleteTransactions([])).toEqual({ ok: false, error: "invalid" });
    expect(await deleteTransactions([items[0], items[0]])).toEqual({ ok: false, error: "invalid" });
    expect(await deleteTransactions([{ id: "nope", revision: 1 }])).toEqual({ ok: false, error: "invalid" });
    expect(await deleteTransactions([{ id: a, revision: 0 }])).toEqual({ ok: false, error: "invalid" });
    expect(await deleteTransactions([{ id: a, revision: 1, amountMinor: 5 } as never])).toEqual({ ok: false, error: "invalid" });
    const many = Array.from({ length: BULK_LIMIT + 1 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, revision: 1 }));
    expect(await deleteTransactions(many)).toEqual({ ok: false, error: "invalid" });
    expect(await setTransactionsCategory(items, "not-a-category")).toEqual({ ok: false, error: "invalid" });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("reports the database refusal for the whole batch and does not revalidate", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "BT003", message: "transaction conflict" } });
    expect(await deleteTransactions(items)).toEqual({ ok: false, error: "conflict" });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "loan.managedTransaction" } });
    expect(await deleteTransactions(items)).toEqual({ ok: false, error: "managedTransaction" });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "category_unavailable" } });
    expect(await setTransactionsCategory(items, category)).toEqual({ ok: false, error: "categoryUnavailable" });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation secret_table does not exist" } });
    expect(await deleteTransactions(items)).toEqual({ ok: false, error: "failed" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("does not trust a result that is short, foreign, repeated or behind the sent revision", async () => {
    for (const data of [
      [{ id: a, revision: 2 }],
      [{ id: a, revision: 2 }, { id: category, revision: 5 }],
      [{ id: a, revision: 2 }, { id: a, revision: 3 }],
      [{ id: a, revision: 2 }, { id: b, revision: 3 }],
      null,
    ]) {
      mocks.rpc.mockResolvedValue({ data, error: null });
      expect(await deleteTransactions(items)).toEqual({ ok: false, error: "failed" });
    }
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("changes the category of a batch through one RPC", async () => {
    expect(await setTransactionsCategory(items, category)).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("set_transactions_category", { p_items: items, p_category_id: category });
  });

  it("keeps demo and thrown errors as stable codes", async () => {
    mocks.client.mockResolvedValue({ error: "notConfigured" });
    expect(await deleteTransactions(items)).toEqual({ ok: false, error: "notConfigured" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.client.mockRejectedValue(new Error("network"));
    expect(await deleteTransactions(items)).toEqual({ ok: false, error: "failed" });
  });
});

describe("which rows a batch may touch", () => {
  const row = (patch: Partial<Transaction>): Transaction => ({
    id: a, kind: "expense", occurredOn: "2026-11-04", amountMinor: 100, currency: "USD", balanceId: b, categoryId: category,
    toBalanceId: null, toAmountMinor: null, note: null, createdAt: "2026-11-04T00:00:00Z", ...emptyTransactionMetadata(), ...patch,
  });
  it("never offers loan movements for deletion", () => {
    expect(canBulkDelete(row({}))).toBe(true);
    expect(canBulkDelete(row({ kind: "transfer" }))).toBe(true);
    expect(canBulkDelete(row({ kind: "loan", source: "loan" }))).toBe(false);
  });
  it("recategorizes only expenses and incomes entered by hand", () => {
    expect(canBulkRecategorize(row({}))).toBe(true);
    expect(canBulkRecategorize(row({ kind: "income" }))).toBe(true);
    expect(canBulkRecategorize(row({ kind: "transfer", categoryId: null }))).toBe(false);
    expect(canBulkRecategorize(row({ kind: "income", source: "salary" }))).toBe(false);
    expect(canBulkRecategorize(row({ source: "fixed", fixedExpenseId: a }))).toBe(false);
    expect(canBulkRecategorize(row({ installmentId: a }))).toBe(false);
    expect(canBulkRecategorize(row({ kind: "loan", source: "loan", loanId: a }))).toBe(false);
  });
});
