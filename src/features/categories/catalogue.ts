// Kept free of zod so client components can import it without the validation library.
import type { TileColor, TileId } from "@/components/tiles/tile-glyph";

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
  return value === null ? null : value.replace(/[ \t\r\n\f\v ]+/g, " ").replace(/^ | $/g, "") || null;
}

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
