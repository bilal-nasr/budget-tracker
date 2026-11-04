import { describe, expect, it } from "vitest";
import { activeCategories, categoryCreateSchema, categoryEditSchema, categoryName, categoryOptions, normalizeCategoryName, type Category } from "./schema";

const row = (id: string, patch: Partial<Category> = {}): Category => ({
  id, kind: "expense", nameEn: id, nameAr: null, tile: 1, color: "teal", position: 1,
  parentId: null, archivedAt: null, ...patch,
});
const input = { kind: "expense", nameEn: "Food", nameAr: null, tile: 1, color: "teal" };

describe("category names and validation", () => {
  it("normalizes ASCII whitespace and NBSP; empty names become null", () => {
    expect(normalizeCategoryName(" \tPhone\u00a0\n credits ")).toBe("Phone credits");
    expect(categoryCreateSchema.parse({ ...input, nameEn: "  ", nameAr: "  طعام  " })).toMatchObject({ nameEn: null, nameAr: "طعام" });
    expect(categoryCreateSchema.safeParse({ ...input, nameEn: " ", nameAr: null }).success).toBe(false);
  });
  it("counts Unicode code points rather than UTF-16 units", () => {
    expect(categoryCreateSchema.safeParse({ ...input, nameEn: "🍎".repeat(40) }).success).toBe(true);
    expect(categoryCreateSchema.safeParse({ ...input, nameEn: "🍎".repeat(41) }).success).toBe(false);
  });
  it("rejects arbitrary identity fields, motifs, colors and kinds", () => {
    for (const patch of [{ tile: 9 }, { tile: 1.5 }, { color: "#fff" }, { kind: "transfer" }, { userId: "other" }, { parentId: "other" }, { position: 9 }]) {
      expect(categoryCreateSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    }
    expect(categoryEditSchema.safeParse(input).success).toBe(false);
  });
  it("falls back between languages without changing the saved name", () => {
    expect(categoryName(row("x", { nameEn: null, nameAr: "طعام" }), "en")).toBe("طعام");
    expect(categoryName(row("x", { nameEn: "Food" }), "ar")).toBe("Food");
  });
});

describe("category choices", () => {
  const rows = [row("active"), row("archive", { archivedAt: "2026-11-04T00:00:00Z" }), row("child", { parentId: "active" }), row("income", { kind: "income" })];
  it("offers active roots of the selected kind for creation", () => {
    expect(activeCategories(rows, "expense").map((c) => c.id)).toEqual(["active"]);
    expect(categoryOptions(rows, "expense").map((c) => c.id)).toEqual(["active"]);
    expect(activeCategories(rows, "expense", "active").map((c) => c.id)).toEqual(["child"]);
  });
  it("retains only the current archive or legacy child for editing", () => {
    expect(categoryOptions(rows, "expense", "archive").map((c) => c.id)).toEqual(["active", "archive"]);
    expect(categoryOptions(rows, "expense", "child").map((c) => c.id)).toEqual(["active", "child"]);
    expect(categoryOptions(rows, "expense", "income").map((c) => c.id)).toEqual(["active"]);
  });
});
