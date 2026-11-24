import "server-only";
import { defineTool } from "@/lib/mcp/tool";
import { getCurrencies } from "./queries";

export const currencyTools = [
  defineTool({
    name: "currencies_list",
    title: "List currencies",
    description:
      "List the currencies the person tracks: code, symbol, decimal places (minor-unit size) and whether each is disabled. " +
      "Use it to learn which currency codes exist before calling budgets_get or reading amounts.",
    kind: "read",
    run: async () => ({ currencies: await getCurrencies() }),
  }),
];
