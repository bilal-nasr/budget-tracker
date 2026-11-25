import "server-only";
import { z } from "zod";
import { defineTool, ToolError } from "@/lib/mcp/tool";
import { once, requestIdSchema, unwrap } from "@/lib/mcp/write";
import { createCategory, removeCategory, restoreCategory, updateCategory } from "./actions";
import { getCategories } from "./queries";
import { categoryCreateSchema } from "./schema";

const NOT_FOUND = "That category does not exist. Use categories_list to find its id.";

const categoryId = z.uuid().describe("Category id from categories_list.");
const fields = categoryCreateSchema.shape;
const nameEn = fields.nameEn.optional().describe("English name, up to 40 characters; null or omitted for none. At least one of nameEn and nameAr is needed.");
const nameAr = fields.nameAr.optional().describe("Arabic name, up to 40 characters; null or omitted for none. At least one of nameEn and nameAr is needed.");
const tile = fields.tile.describe("Tile pattern number, 1 to 15.");
const color = fields.color.describe("Tile color: teal, oxblood or ochre.");

/** One category as categories_list gives it, re-read after a change. */
async function categoryOut(id: string) {
  const category = (await getCategories()).find((c) => c.id === id);
  if (!category) throw new ToolError(NOT_FOUND);
  return category;
}

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
  defineTool({
    name: "categories_create",
    title: "Create category",
    description:
      "Create a new top-level expense or income category. Give at least one name (English and/or Arabic, up to 40 characters each), a tile pattern (1 to 15) and a color. " +
      "Returns the new category in the shape categories_list gives. Send a requestId and reuse it when retrying so the category is never created twice.",
    kind: "write",
    input: z
      .strictObject({
        requestId: requestIdSchema,
        kind: fields.kind.describe("expense or income."),
        nameEn,
        nameAr,
        tile,
        color,
      })
      .refine((input) => (input.nameEn ?? null) !== null || (input.nameAr ?? null) !== null, {
        message: "Give at least one name",
        path: ["nameEn"],
      }),
    run: ({ requestId, kind, nameEn, nameAr, tile, color }) =>
      once("categories_create", requestId, async () => {
        const created = unwrap<{ ok: true; id: string }>(await createCategory({ kind, nameEn: nameEn ?? null, nameAr: nameAr ?? null, tile, color }));
        return { category: await categoryOut(created.id) };
      }),
  }),
  defineTool({
    name: "categories_update",
    title: "Update category",
    description:
      "Change the names, tile or color of an existing active top-level category (not its kind). Id comes from categories_list. " +
      "Fields you leave out keep their current value; pass null for a name to clear it (the other name must remain). Returns the updated category.",
    kind: "write",
    input: z.strictObject({ id: categoryId, nameEn, nameAr, tile: tile.optional(), color: color.optional() }),
    run: async ({ id, nameEn, nameAr, tile, color }) => {
      const current = (await getCategories()).find((c) => c.id === id);
      if (!current) throw new ToolError(NOT_FOUND);
      unwrap(
        await updateCategory(id, {
          nameEn: nameEn === undefined ? current.nameEn : nameEn,
          nameAr: nameAr === undefined ? current.nameAr : nameAr,
          tile: tile ?? current.tile,
          color: color ?? current.color,
        }),
      );
      return { category: await categoryOut(id) };
    },
  }),
  defineTool({
    name: "categories_delete",
    title: "Delete category",
    description:
      "Remove a category. One that was never used is deleted for good (outcome \"deleted\"); one that has transactions, budgets or other history is archived instead " +
      "(outcome \"archived\") and can be brought back with categories_restore. Id comes from categories_list. Returns { deleted: true, id, outcome }.",
    kind: "destructive",
    input: z.strictObject({ id: categoryId }),
    run: async ({ id }) => {
      const result = unwrap<{ ok: true; outcome: "deleted" | "archived" }>(await removeCategory(id));
      return { deleted: true, id, outcome: result.outcome };
    },
  }),
  defineTool({
    name: "categories_restore",
    title: "Restore category",
    description:
      "Bring an archived top-level category back into use. Id comes from categories_list (archived categories have archivedAt set). Returns the restored category.",
    kind: "write",
    input: z.strictObject({ id: categoryId }),
    run: async ({ id }) => {
      unwrap(await restoreCategory(id));
      return { category: await categoryOut(id) };
    },
  }),
];
