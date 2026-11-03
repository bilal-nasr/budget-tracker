import type { TileColor, TileId } from "@/components/tiles/tile-glyph";

export type Category = {
  id: string;
  kind: "expense" | "income";
  nameEn: string | null;
  nameAr: string | null;
  tile: TileId;
  color: TileColor;
  position: number;
};

/** Shows the name in the viewer's language, falling back to the other one. */
export function categoryName(category: Pick<Category, "nameEn" | "nameAr">, locale: string): string {
  const primary = locale === "ar" ? category.nameAr : category.nameEn;
  return primary ?? category.nameEn ?? category.nameAr ?? "";
}
