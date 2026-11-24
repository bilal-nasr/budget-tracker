import "server-only";
import { defineTool } from "@/lib/mcp/tool";
import { getCategories } from "./queries";

export const categoryTools = [
  defineTool({
    name: "categories_list",
    title: "List categories",
    description:
      "List expense and income categories with English and Arabic names, parent category and archived state. " +
      "Use it to find a category id before filtering transactions_list by categoryId or reading budgets_get rows.",
    kind: "read",
    run: async () => ({ categories: await getCategories() }),
  }),
];
