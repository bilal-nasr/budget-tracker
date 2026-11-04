import { z } from "zod";
import type { TileColor, TileId } from "@/components/tiles/tile-glyph";
import type { ActionResult } from "@/lib/supabase/action";

export type Category = {
  id: string;
  kind: "expense" | "income";
  nameEn: string | null;
  nameAr: string | null;
  tile: TileId;
  color: TileColor;
  position: number;
  parentId: string | null;
  archivedAt: string | null;
};

/** Matches category_normalize_name in the database; avoid locale-dependent folding. */
export function normalizeCategoryName(value: string | null): string | null {
  return value === null ? null : value.replace(/[ \t\r\n\f\v\u00a0]+/g, " ").replace(/^ | $/g, "") || null;
}

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
export type CategoryCreateInput = z.input<typeof categoryCreateSchema>;
export type CategoryEditInput = z.input<typeof categoryEditSchema>;

export type CategoryActionResult<T = object> = ActionResult<T>;

export function activeCategories(categories: readonly Category[], kind: Category["kind"], parentId: string | null = null): Category[] {
  return categories.filter((c) => c.kind === kind && c.parentId === parentId && c.archivedAt === null);
}

/** currentId is for an EXISTING transaction only, never a create preset. */
export function categoryOptions(categories: readonly Category[], kind: Category["kind"], currentId?: string): Category[] {
  const active = activeCategories(categories, kind);
  const current = currentId ? categories.find((c) => c.id === currentId && c.kind === kind) : undefined;
  return current && !active.some((c) => c.id === current.id) ? [...active, current] : active;
}

/** Shows the name in the viewer's language, falling back to the other one. */
export function categoryName(category: Pick<Category, "nameEn" | "nameAr">, locale: string): string {
  const primary = locale === "ar" ? category.nameAr : category.nameEn;
  return primary ?? category.nameEn ?? category.nameAr ?? "";
}
