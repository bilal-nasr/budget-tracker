import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool, ToolError } from "@/lib/mcp/tool";
import { unwrap, requestIdSchema } from "@/lib/mcp/write";
import { createItem, deleteItem, updateItem } from "./actions";
import { getShoppingItems } from "./queries";
import { itemCreateSchema, itemEditSchema, type ShoppingItem } from "./schema";
import { lineMinor } from "./totals";

const ITEM_NOT_FOUND = "Item not found.";
const REQUEST_TAKEN = "This requestId already belongs to a different item. Use a new requestId.";
const REQUEST_DIFFERENT = "This requestId was already used with different values. Use a new requestId.";

/** One shopping item the way shopping_items_list shows it. */
const itemOut = (item: ShoppingItem, amount: ReturnType<typeof amountFormatter>) => ({
  ...item,
  price: amount(item.priceMinor, item.currency),
  lineTotal: amount(lineMinor(item), item.currency),
});

/** The item with this id, re-read through the same query and shape as the list tool, or null. */
async function readItem(id: string) {
  const [items, currencies] = await Promise.all([getShoppingItems(), getCurrencies()]);
  const item = items.find((candidate) => candidate.id === id);
  return item ? itemOut(item, amountFormatter(currencies)) : null;
}

const itemId = z.uuid().describe("The item's id, from shopping_items_list.");
const nameField = itemEditSchema.shape.name.describe("The item's name (1 to 60 characters).");
const priceField = itemEditSchema.shape.priceMinor.describe("Price of ONE unit in minor units (USD cents, LBP whole lira, SYP whole pounds), at least 1. Not a decimal.");
const quantityField = itemEditSchema.shape.quantity.describe("How many units, each at the price (1 to 9999). price x quantity must stay in the money range.");

export const itemTools = [
  defineTool({
    name: "shopping_items_list",
    title: "List shopping items",
    description:
      "List the shopping list, newest first. `price` is the cost of ONE unit and `lineTotal` is price times quantity; " +
      "an item with `boughtOn` set has been bought. Items are in different currencies and are never summed.",
    kind: "read",
    run: async () => {
      const [items, currencies] = await Promise.all([getShoppingItems(), getCurrencies()]);
      const amount = amountFormatter(currencies);
      return { items: items.map((item) => itemOut(item, amount)) };
    },
  }),
  defineTool({
    name: "shopping_items_create",
    title: "Add a shopping item",
    description:
      "Add an item to the shopping list. It is only a note of something to buy: it moves no money and records nothing in Activity. " +
      "`priceMinor` is the price of ONE unit in minor units (USD cents, LBP whole lira, SYP whole pounds), so $1.50 is 150. `currency` is a code the person has enabled (see currencies_list). " +
      "Returns the item in the same shape as shopping_items_list, including its `id`. Send the same `requestId` when retrying so the item is never added twice.",
    kind: "write",
    input: z.strictObject({
      name: nameField,
      currency: itemCreateSchema.shape.currency.describe("Currency code of the price, for example USD or LBP. Must be one of the person's enabled currencies."),
      priceMinor: priceField,
      quantity: quantityField.default(1),
      requestId: requestIdSchema,
    }),
    run: async ({ requestId, name, currency, priceMinor, quantity }) => {
      // The request id is the row id, so a retry (even after a lost response) finds the same row.
      const id = requestId ?? crypto.randomUUID();
      unwrap(await createItem({ id, name, currency, priceMinor, quantity }));
      // The create is a no-op for an id that already exists, so check what is really there.
      const item = await readItem(id);
      if (!item) throw new ToolError(REQUEST_TAKEN);
      if (item.name !== name.trim() || item.currency !== currency.trim().toUpperCase() || item.priceMinor !== priceMinor || item.quantity !== quantity) {
        throw new ToolError(REQUEST_DIFFERENT);
      }
      return item;
    },
  }),
  defineTool({
    name: "shopping_items_update",
    title: "Edit a shopping item",
    description:
      "Change the name, unit price or quantity of a shopping item (get `itemId` from shopping_items_list). Fields you leave out keep their current value. " +
      "The currency cannot be changed. An item already bought cannot be edited: correct the expense in Activity instead. " +
      "`priceMinor` is the price of ONE unit in minor units. Moves no money. Returns the updated item in the shopping_items_list shape.",
    kind: "write",
    input: z.strictObject({
      itemId,
      name: nameField.optional(),
      priceMinor: priceField.optional(),
      quantity: quantityField.optional(),
    }).refine((value) => value.name !== undefined || value.priceMinor !== undefined || value.quantity !== undefined, { message: "Give at least one of name, priceMinor, quantity." }),
    run: async ({ itemId: id, name, priceMinor, quantity }) => {
      const current = (await getShoppingItems()).find((item) => item.id === id);
      if (!current) throw new ToolError(ITEM_NOT_FOUND);
      unwrap(await updateItem(id, {
        name: name ?? current.name,
        priceMinor: priceMinor ?? current.priceMinor,
        quantity: quantity ?? current.quantity,
      }));
      const item = await readItem(id);
      if (!item) throw new ToolError(ITEM_NOT_FOUND);
      return item;
    },
  }),
  defineTool({
    name: "shopping_items_delete",
    title: "Delete a shopping item",
    description:
      "Delete one item from the shopping list (get `itemId` from shopping_items_list). It cannot be undone. " +
      "If the item was already bought, the expense recorded in Activity stays as it is. Returns { deleted: true, id }; an item that is already gone also counts as deleted.",
    kind: "destructive",
    input: z.strictObject({ itemId }),
    run: async ({ itemId: id }) => {
      unwrap(await deleteItem(id));
      return { deleted: true, id };
    },
  }),
];
