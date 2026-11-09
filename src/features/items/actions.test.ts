import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data?: unknown; error?: { code?: string; message?: string } | null };
const mocks = vi.hoisted(() => ({ ctx: vi.fn(), invalidate: vi.fn(), create: vi.fn(), tables: {} as Record<string, unknown>, calls: [] as [string, string, unknown[]][] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.invalidate }));
vi.mock("@/lib/supabase/action", async (original) => ({ ...(await original<typeof import("@/lib/supabase/action")>()), actionClient: mocks.ctx }));
vi.mock("@/features/profile/queries", () => ({ getProfile: async () => ({ timezone: "Asia/Beirut" }) }));
vi.mock("@/features/transactions/mutations-core", () => ({ createTransactionCore: mocks.create }));
import { buyItems, createItem, deleteItem, moveItemsToFolder, updateItem } from "./actions";

const uid = (n: number) => `ac000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [milk, bread, request, balance, category] = [uid(1), uid(2), uid(3), uid(4), uid(5)];
const row = (id: string, name: string, price: number, extra: Record<string, unknown> = {}) =>
  ({ id, name, currency: "USD", price_minor: price, created_at: `2026-11-0${id === milk ? 1 : 2}T00:00:00Z`, bought_on: null, transaction_id: null, ...extra });

/** Chainable stand-in for a PostgREST query: every method returns itself, awaiting yields the table's result. */
function query(table: string): unknown {
  const self: Record<string, unknown> = {};
  for (const method of ["select", "in", "eq", "update", "delete", "upsert", "maybeSingle"]) {
    self[method] = (...args: unknown[]) => { mocks.calls.push([table, method, args]); return self; };
  }
  self.then = (resolve: (value: Result) => unknown) => resolve(mocks.tables[table] as Result);
  return self;
}
const input = { requestId: request, itemIds: [milk, bread], balanceId: balance, categoryId: category, occurredOn: "2026-01-01" };
const called = (table: string, method: string) => mocks.calls.filter(([t, m]) => t === table && m === method);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.ctx.mockResolvedValue({ supabase: { from: query }, userId: uid(9) });
  mocks.create.mockResolvedValue({ ok: true, id: request, revision: 1 });
  mocks.tables = {
    shopping_item_status: { data: [row(milk, "Milk", 350), row(bread, "Bread", 150)], error: null },
    wallet_balances: { data: { currency: "USD" }, error: null },
    transactions: { data: null, error: null },
    shopping_items: { data: [{ id: milk }, { id: bread }], error: null },
  };
});

describe("buyItems", () => {
  it("validates before any database access", async () => {
    expect(await buyItems({ ...input, itemIds: [] })).toEqual({ ok: false, error: "invalid" });
    expect(await buyItems({ ...input, itemIds: [milk, milk] })).toEqual({ ok: false, error: "invalid" });
    expect(await buyItems({ ...input, occurredOn: "2099-01-01" })).toEqual({ ok: false, error: "invalid" });
    expect(mocks.ctx).not.toHaveBeenCalled();
  });

  it("records one expense for the total, itemised by name, then links every item", async () => {
    expect(await buyItems(input)).toEqual({ ok: true, id: request, revision: 1 });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      kind: "expense", amountMinor: 500, balanceId: balance, categoryId: category, note: "Milk, Bread",
      items: [{ description: "Milk", amountMinor: 350 }, { description: "Bread", amountMinor: 150 }],
    }), request);
    expect(called("shopping_items", "update")[0][2]).toEqual([{ bought_transaction_id: request }]);
    expect(mocks.invalidate).toHaveBeenCalledWith("/", "layout");
  });

  it("uses the name as the note and no breakdown for a single item", async () => {
    mocks.tables.shopping_item_status = { data: [row(milk, "Milk", 350)], error: null };
    mocks.tables.shopping_items = { data: [{ id: milk }], error: null };
    expect(await buyItems({ ...input, itemIds: [milk] })).toMatchObject({ ok: true });
    const [sent] = mocks.create.mock.calls[0];
    expect(sent).toMatchObject({ amountMinor: 350, note: "Milk" });
    expect(sent).not.toHaveProperty("items");
  });

  it("completes a retry without recording the expense twice", async () => {
    mocks.tables.transactions = { data: { id: request, revision: 1, kind: "expense", amount_minor: 500, deleted_at: null }, error: null };
    mocks.tables.shopping_item_status = { data: [row(milk, "Milk", 350, { bought_on: "2026-01-01", transaction_id: request }), row(bread, "Bread", 150)], error: null };
    expect(await buyItems(input)).toEqual({ ok: true, id: request, revision: 1 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses items that changed, mixed currencies and a wallet in another currency", async () => {
    mocks.tables.shopping_item_status = { data: [row(milk, "Milk", 350)], error: null };
    expect(await buyItems(input)).toEqual({ ok: false, error: "conflict" });
    mocks.tables.shopping_item_status = { data: [row(milk, "Milk", 350, { bought_on: "2026-01-01", transaction_id: uid(8) }), row(bread, "Bread", 150)], error: null };
    expect(await buyItems(input)).toEqual({ ok: false, error: "conflict" });
    mocks.tables.shopping_item_status = { data: [row(milk, "Milk", 350), row(bread, "Bread", 150, { currency: "LBP" })], error: null };
    expect(await buyItems(input)).toEqual({ ok: false, error: "invalid" });
    mocks.tables.shopping_item_status = { data: [row(milk, "Milk", 350), row(bread, "Bread", 150)], error: null };
    mocks.tables.wallet_balances = { data: { currency: "LBP" }, error: null };
    expect(await buyItems(input)).toEqual({ ok: false, error: "walletUnavailable" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("surfaces ledger errors and reports an unconfirmed link as retryable", async () => {
    mocks.create.mockResolvedValueOnce({ ok: false, error: "walletUnavailable" });
    expect(await buyItems(input)).toEqual({ ok: false, error: "walletUnavailable" });
    expect(called("shopping_items", "update")).toHaveLength(0);
    mocks.tables.shopping_items = { data: [{ id: milk }], error: null };
    expect(await buyItems(input)).toEqual({ ok: false, error: "failed" });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("reports preview mode", async () => {
    mocks.ctx.mockResolvedValueOnce({ error: "notConfigured" });
    expect(await buyItems(input)).toEqual({ ok: false, error: "notConfigured" });
  });
});

describe("moveItemsToFolder", () => {
  const folder = uid(20);
  const move = { expectedUnits: { USD: 2 }, folderId: folder, itemIds: [milk, bread] };

  it("validates before any database access", async () => {
    expect(await moveItemsToFolder({ ...move, itemIds: [] })).toEqual({ ok: false, error: "invalid" });
    expect(await moveItemsToFolder({ ...move, itemIds: [milk, milk] })).toEqual({ ok: false, error: "invalid" });
    expect(await moveItemsToFolder({ ...move, folderId: "x" })).toEqual({ ok: false, error: "invalid" });
    expect(await moveItemsToFolder({ ...move, expectedUnits: {} })).toEqual({ ok: false, error: "invalid" });
    expect(mocks.ctx).not.toHaveBeenCalled();
  });

  it("adds the items as folder rows under their own ids, then removes them from the list", async () => {
    mocks.tables.invoice_items = { data: [], error: null };
    expect(await moveItemsToFolder(move)).toEqual({ ok: true, moved: 2 });
    expect(called("invoice_items", "upsert")[0][2]).toEqual([
      [
        { id: milk, folder_id: folder, name: "Milk", currency: "USD", decimal_places: 2, price_minor: 350 },
        { id: bread, folder_id: folder, name: "Bread", currency: "USD", decimal_places: 2, price_minor: 150 },
      ],
      { onConflict: "id", ignoreDuplicates: true },
    ]);
    expect(called("shopping_items", "delete")).toHaveLength(1);
    expect(called("shopping_items", "in")[0][2]).toEqual(["id", [milk, bread]]);
    expect(mocks.invalidate).toHaveBeenCalledWith("/", "layout");
  });

  it("treats items already in the folder as moved (a retry after a lost response)", async () => {
    mocks.tables.shopping_item_status = { data: [], error: null };
    mocks.tables.invoice_items = { data: [{ id: milk }, { id: bread }], error: null };
    expect(await moveItemsToFolder(move)).toEqual({ ok: true, moved: 2 });
    expect(called("invoice_items", "upsert")).toHaveLength(0);
    expect(called("shopping_items", "delete")).toHaveLength(0);
  });

  it("refuses items that vanished, were bought or have no units", async () => {
    mocks.tables.shopping_item_status = { data: [row(milk, "Milk", 350)], error: null };
    mocks.tables.invoice_items = { data: [], error: null };
    expect(await moveItemsToFolder(move)).toEqual({ ok: false, error: "conflict" });
    mocks.tables.shopping_item_status = { data: [row(milk, "Milk", 350, { bought_on: "2026-01-01", transaction_id: uid(8) }), row(bread, "Bread", 150)], error: null };
    expect(await moveItemsToFolder(move)).toEqual({ ok: false, error: "conflict" });
    mocks.tables.shopping_item_status = { data: [row(milk, "Milk", 350), row(bread, "Bread", 150, { currency: "LBP" })], error: null };
    expect(await moveItemsToFolder(move)).toEqual({ ok: false, error: "invalid" });
    expect(called("invoice_items", "upsert")).toHaveLength(0);
    expect(called("shopping_items", "delete")).toHaveLength(0);
  });

  it("maps folder rules and keeps the items when the insert fails", async () => {
    mocks.tables.invoice_items = { data: null, error: { code: "P0001", message: "invoices.limit" } };
    expect(await moveItemsToFolder(move)).toEqual({ ok: false, error: "limitReached" });
    mocks.tables.invoice_items = { data: null, error: { code: "42501", message: "invoices.invalid" } };
    expect(await moveItemsToFolder(move)).toEqual({ ok: false, error: "conflict" });
    mocks.tables.invoice_items = { data: null, error: { code: "P0001", message: "invoices.invalid" } };
    expect(await moveItemsToFolder(move)).toEqual({ ok: false, error: "currencyUnavailable" });
    expect(called("shopping_items", "delete")).toHaveLength(0);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("reports a failed removal as retryable", async () => {
    mocks.tables.invoice_items = { data: [], error: null };
    mocks.tables.shopping_items = { data: null, error: { message: "boom" } };
    expect(await moveItemsToFolder(move)).toEqual({ ok: false, error: "failed" });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});

describe("item CRUD", () => {
  it("creates idempotently, edits, and deletes", async () => {
    mocks.tables.shopping_items = { data: [{ id: milk }], error: null };
    expect(await createItem({ id: milk, name: " Milk ", currency: "usd", priceMinor: 350 })).toEqual({ ok: true, id: milk });
    expect(called("shopping_items", "upsert")[0][2]).toEqual([{ id: milk, name: "Milk", currency: "USD", price_minor: 350 }, { onConflict: "id", ignoreDuplicates: true }]);
    expect(await updateItem(milk, { name: "Oat milk", priceMinor: 400 })).toEqual({ ok: true });
    expect(await deleteItem(milk)).toEqual({ ok: true });
    expect(mocks.invalidate).toHaveBeenCalledTimes(3);
  });

  it("rejects bad input and maps database rules", async () => {
    expect(await createItem({ id: "x", name: "Milk", currency: "USD", priceMinor: 350 })).toEqual({ ok: false, error: "invalid" });
    expect(await createItem({ id: milk, name: "Milk", currency: "USD", priceMinor: 0 })).toEqual({ ok: false, error: "invalid" });
    expect(await updateItem("x", { name: "Milk", priceMinor: 1 })).toEqual({ ok: false, error: "invalid" });
    expect(await deleteItem("x")).toEqual({ ok: false, error: "invalid" });
    mocks.tables.shopping_items = { data: null, error: { message: "items.bought" } };
    expect(await updateItem(milk, { name: "Milk", priceMinor: 1 })).toEqual({ ok: false, error: "conflict" });
    mocks.tables.shopping_items = { data: [], error: null };
    expect(await updateItem(milk, { name: "Milk", priceMinor: 1 })).toEqual({ ok: false, error: "conflict" });
    mocks.tables.shopping_items = { data: null, error: { message: "internal details" } };
    expect(await deleteItem(milk)).toEqual({ ok: false, error: "failed" });
  });
});
