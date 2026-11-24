import "server-only";
import { getCurrencies } from "@/features/currencies/queries";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool } from "@/lib/mcp/tool";
import { getShoppingItems } from "./queries";
import { lineMinor } from "./totals";

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
      return {
        items: items.map((item) => ({
          ...item,
          price: amount(item.priceMinor, item.currency),
          lineTotal: amount(lineMinor(item), item.currency),
        })),
      };
    },
  }),
];
