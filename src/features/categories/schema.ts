import { z } from "zod";
import type { ActionResult } from "@/lib/supabase/action";
import { normalizeCategoryName } from "./catalogue";
export { normalizeCategoryName, activeCategories, categoryOptions, categoryName } from "./catalogue";
export type { Category } from "./catalogue";

const nameSchema = z.string().nullable().transform(normalizeCategoryName).refine(
  (value) => value === null || Array.from(value).length <= 40,
  { message: "nameLength" },
);
const editableFields = {
  nameEn: nameSchema,
  nameAr: nameSchema,
  tile: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8)]),
  color: z.enum(["teal", "oxblood", "ochre"]),
};
const hasName = (input: { nameEn: string | null; nameAr: string | null }) => input.nameEn !== null || input.nameAr !== null;
export const categoryCreateSchema = z.strictObject({ kind: z.enum(["expense", "income"]), ...editableFields }).refine(hasName, { message: "nameRequired", path: ["nameEn"] });
export const categoryEditSchema = z.strictObject(editableFields).refine(hasName, { message: "nameRequired", path: ["nameEn"] });
export const categoryOrderSchema = z.strictObject({
  kind: z.enum(["expense", "income"]),
  ids: z.array(z.uuid()).min(1).max(500),
}).refine(({ ids }) => new Set(ids).size === ids.length, { message: "duplicateId", path: ["ids"] });
export type CategoryCreateInput = z.input<typeof categoryCreateSchema>;
export type CategoryEditInput = z.input<typeof categoryEditSchema>;

export type CategoryActionResult<T = object> = ActionResult<T>;
