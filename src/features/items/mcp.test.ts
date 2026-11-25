import { beforeEach, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));
const getShoppingItems = vi.fn();
const getCurrencies = vi.fn();
const createItem = vi.fn();
const updateItem = vi.fn();
const deleteItem = vi.fn();
vi.mock("./queries", () => ({ getShoppingItems: () => getShoppingItems() }));
vi.mock("./actions", () => ({
  createItem: (...args: unknown[]) => createItem(...args),
  updateItem: (...args: unknown[]) => updateItem(...args),
  deleteItem: (...args: unknown[]) => deleteItem(...args),
}));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
import { ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT } from "@/lib/mcp/write";
import { itemTools } from "./mcp";

const tool = (name: string) => itemTools.find((t) => t.name === name)!;
const ID = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const row = (over: Record<string, unknown> = {}) => ({
  id: ID, name: "Notebook", currency: "USD", priceMinor: 150, quantity: 3, createdAt: "x", boughtOn: null, transactionId: null, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
});

test("shopping_items_list shows the unit price and the line total (price times quantity)", async () => {
  getShoppingItems.mockResolvedValue([
    { id: "a", name: "Notebook", currency: "USD", priceMinor: 150, quantity: 3, createdAt: "x", boughtOn: null, transactionId: null },
    { id: "b", name: "Bread", currency: "LBP", priceMinor: 45000, quantity: 2, createdAt: "x", boughtOn: "2026-11-02", transactionId: "t" },
  ]);
  const [tool] = itemTools;
  expect(tool.name).toBe("shopping_items_list");
  expect(tool.kind).toBe("read");
  const out = (await tool.run({})) as { items: Record<string, unknown>[] };
  expect(out.items[0]).toMatchObject({
    priceMinor: 150, price: { minor: 150, currency: "USD", text: "$1.50" }, lineTotal: { minor: 450, currency: "USD", text: "$4.50" },
  });
  expect(out.items[1]).toMatchObject({ lineTotal: { minor: 90000, currency: "LBP", text: "LBP 90,000" } });
});

test("write tools come after the read tool and have the right kinds", () => {
  expect(itemTools[0].name).toBe("shopping_items_list");
  expect(tool("shopping_items_create").kind).toBe("write");
  expect(tool("shopping_items_update").kind).toBe("write");
  expect(tool("shopping_items_delete").kind).toBe("destructive");
});

test("shopping_items_create uses the requestId as the item id and returns the re-read item", async () => {
  createItem.mockResolvedValue({ ok: true, id: REQ });
  getShoppingItems.mockResolvedValue([row({ id: REQ })]);
  const out = await tool("shopping_items_create").run({ name: " Notebook ", currency: "USD", priceMinor: 150, quantity: 3, requestId: REQ });
  expect(createItem).toHaveBeenCalledWith({ id: REQ, name: " Notebook ", currency: "USD", priceMinor: 150, quantity: 3 });
  expect(out).toMatchObject({ id: REQ, price: { minor: 150, text: "$1.50" }, lineTotal: { minor: 450, text: "$4.50" } });
});

test("shopping_items_create generates an id without a requestId", async () => {
  createItem.mockImplementation(async (input: { id: string }) => {
    getShoppingItems.mockResolvedValue([row({ id: input.id })]);
    return { ok: true, id: input.id };
  });
  const out = (await tool("shopping_items_create").run({ name: "Notebook", currency: "USD", priceMinor: 150, quantity: 3 })) as { id: string };
  expect(out.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(createItem.mock.calls[0][0].id).toBe(out.id);
});

test("shopping_items_create with a reused requestId returns the existing item, not a duplicate", async () => {
  createItem.mockResolvedValue({ ok: true, id: REQ }); // the action is a no-op for an existing id
  getShoppingItems.mockResolvedValue([row({ id: REQ })]);
  const input = { name: "Notebook", currency: "USD", priceMinor: 150, quantity: 3, requestId: REQ };
  const first = await tool("shopping_items_create").run(input);
  const second = await tool("shopping_items_create").run(input);
  expect(second).toEqual(first);
});

test("shopping_items_create refuses a requestId that is taken by other values or is not the person's row", async () => {
  createItem.mockResolvedValue({ ok: true, id: REQ });
  getShoppingItems.mockResolvedValue([row({ id: REQ, priceMinor: 999 })]);
  await expect(tool("shopping_items_create").run({ name: "Notebook", currency: "USD", priceMinor: 150, quantity: 3, requestId: REQ }))
    .rejects.toBeInstanceOf(ToolError);
  getShoppingItems.mockResolvedValue([]);
  await expect(tool("shopping_items_create").run({ name: "Notebook", currency: "USD", priceMinor: 150, quantity: 3, requestId: REQ }))
    .rejects.toMatchObject({ message: expect.stringContaining("requestId") });
});

test("shopping_items_create turns an action error into the fixed sentence", async () => {
  createItem.mockResolvedValue({ ok: false, error: "currencyUnavailable" });
  await expect(tool("shopping_items_create").run({ name: "A", currency: "XXX", priceMinor: 1, quantity: 1, requestId: REQ }))
    .rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.currencyUnavailable });
});

test("shopping_items_create input is strict and validates", () => {
  const input = tool("shopping_items_create").input!;
  const ok = { name: "A", currency: "USD", priceMinor: 100, quantity: 1 };
  expect(input.safeParse(ok).success).toBe(true);
  expect(input.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  expect(input.safeParse({ ...ok, expectedUnits: { USD: 2 } }).success).toBe(false);
  expect(input.safeParse({ ...ok, priceMinor: 1.5 }).success).toBe(false);
  expect(input.safeParse({ ...ok, priceMinor: 0 }).success).toBe(false);
  expect(input.safeParse({ ...ok, name: "" }).success).toBe(false);
  expect(input.safeParse({ ...ok, name: "x".repeat(61) }).success).toBe(false);
  expect(input.safeParse({ ...ok, quantity: 0 }).success).toBe(false);
  expect(input.safeParse({ ...ok, requestId: "nope" }).success).toBe(false);
});

test("shopping_items_update fills missing fields from the current item and returns the re-read item", async () => {
  getShoppingItems.mockResolvedValue([row()]);
  updateItem.mockResolvedValue({ ok: true });
  const out = await tool("shopping_items_update").run({ itemId: ID, priceMinor: 200 });
  expect(updateItem).toHaveBeenCalledWith(ID, { name: "Notebook", priceMinor: 200, quantity: 3 });
  expect(out).toMatchObject({ id: ID, price: { currency: "USD" } });
});

test("shopping_items_update on a missing item is a tool error and does not call the action", async () => {
  getShoppingItems.mockResolvedValue([]);
  await expect(tool("shopping_items_update").run({ itemId: ID, name: "B" })).rejects.toMatchObject({ name: "ToolError", message: "Item not found." });
  expect(updateItem).not.toHaveBeenCalled();
});

test("shopping_items_update turns an action error into the fixed sentence", async () => {
  getShoppingItems.mockResolvedValue([row()]);
  updateItem.mockResolvedValue({ ok: false, error: "conflict" });
  await expect(tool("shopping_items_update").run({ itemId: ID, name: "B" })).rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.conflict });
});

test("shopping_items_update input is strict, validates and needs one field", () => {
  const input = tool("shopping_items_update").input!;
  expect(input.safeParse({ itemId: ID, name: "B" }).success).toBe(true);
  expect(input.safeParse({ itemId: ID }).success).toBe(false);
  expect(input.safeParse({ itemId: ID, name: "B", currency: "USD" }).success).toBe(false);
  expect(input.safeParse({ itemId: "nope", name: "B" }).success).toBe(false);
  expect(input.safeParse({ itemId: ID, priceMinor: -1 }).success).toBe(false);
  expect(input.safeParse({ itemId: ID, quantity: 10000 }).success).toBe(false);
});

test("shopping_items_delete calls the action and returns { deleted, id }", async () => {
  deleteItem.mockResolvedValue({ ok: true });
  expect(await tool("shopping_items_delete").run({ itemId: ID })).toEqual({ deleted: true, id: ID });
  expect(deleteItem).toHaveBeenCalledWith(ID);
});

test("shopping_items_delete turns an action error into the fixed sentence and validates input", async () => {
  deleteItem.mockResolvedValue({ ok: false, error: "conflict" });
  await expect(tool("shopping_items_delete").run({ itemId: ID })).rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.conflict });
  deleteItem.mockResolvedValue({ ok: false, error: "failed" });
  await expect(tool("shopping_items_delete").run({ itemId: ID })).rejects.toMatchObject({ message: ACTION_ERROR_TEXT.failed });
  const input = tool("shopping_items_delete").input!;
  expect(input.safeParse({ itemId: ID }).success).toBe(true);
  expect(input.safeParse({ itemId: ID, extra: 1 }).success).toBe(false);
  expect(input.safeParse({ itemId: "nope" }).success).toBe(false);
});
