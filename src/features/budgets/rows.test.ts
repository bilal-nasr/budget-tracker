import { describe, expect, it } from "vitest";
import type { Category } from "@/features/categories/schema";
import { availableBudgetCurrencies, buildMonthBudgets, isOver } from "./rows";

const cat = (id: string, position: number, kind: "expense" | "income" = "expense"): Category => ({
  id, kind, nameEn: id, nameAr: id, tile: 1, color: "teal", position, parentId: null, archivedAt: null,
});
const categories = [cat("groceries", 1), cat("transport", 2), cat("fun", 3), cat("salary", 4, "income")];
const budgets = [
  { categoryId: "groceries", currency: "USD" as const, limitMinor: 30000 },
  { categoryId: "transport", currency: "USD" as const, limitMinor: 5000 },
  { categoryId: "groceries", currency: "LBP" as const, limitMinor: 9_000_000 },
];
const spend = [
  { categoryId: "groceries", currency: "USD" as const, spentMinor: 34000 },
  { categoryId: "fun", currency: "USD" as const, spentMinor: 1500 },
  { categoryId: "groceries", currency: "LBP" as const, spentMinor: 2_000_000 },
];

describe("buildMonthBudgets", () => {
  const usd = buildMonthBudgets("2026-11", "USD", categories, budgets, spend);

  it("isolates SYP whole pounds even when the category has USD and LBP amounts", () => {
    const syp = buildMonthBudgets("2026-11", "SYP", categories,
      [...budgets, { categoryId: "groceries", currency: "SYP", limitMinor: 5000 }],
      [...spend, { categoryId: "groceries", currency: "SYP", spentMinor: 1250 }]);
    expect(syp.totalLimitMinor).toBe(5000);
    expect(syp.totalSpentMinor).toBe(1250);
    expect(syp.rows[0].leftMinor).toBe(3750);
    expect(availableBudgetCurrencies([{ code: "SYP", disabled: true }], [syp])).toEqual(["SYP"]);
    expect(availableBudgetCurrencies([{ code: "SYP", disabled: false }], [])).toEqual(["SYP"]);
  });

  it("computes left and progress, and flags over-budget rows", () => {
    const groceries = usd.rows[0];
    expect(groceries).toMatchObject({ categoryId: "groceries", leftMinor: -4000 });
    expect(groceries.progress).toBeCloseTo(34000 / 30000);
    expect(isOver(groceries)).toBe(true);
  });

  it("keeps a budgeted category with no spending at zero progress", () => {
    expect(usd.rows[1]).toMatchObject({ categoryId: "transport", spentMinor: 0, progress: 0, leftMinor: 5000 });
    expect(isOver(usd.rows[1])).toBe(false);
  });

  it("lists spending without a budget after the budgeted rows", () => {
    expect(usd.rows[2]).toMatchObject({ categoryId: "fun", limitMinor: null, spentMinor: 1500, leftMinor: null });
    expect(usd.rows).toHaveLength(3);
  });

  it("totals the limits, and all spending including unbudgeted", () => {
    expect(usd.totalLimitMinor).toBe(35000);
    expect(usd.totalSpentMinor).toBe(35500);
  });

  it("never mixes currencies", () => {
    const lbp = buildMonthBudgets("2026-11", "LBP", categories, budgets, spend);
    expect(lbp.rows).toHaveLength(1);
    expect(lbp.totalLimitMinor).toBe(9_000_000);
    expect(lbp.totalSpentMinor).toBe(2_000_000);
  });

  it("is empty when there are no budgets and no spending", () => {
    const empty = buildMonthBudgets("2026-01", "USD", categories, [], []);
    expect(empty.rows).toEqual([]);
    expect(empty.totalLimitMinor).toBe(0);
  });

  it("keeps archived roots with spending or limits and omits empty archives", () => {
    const archived = categories.map((c) => ({ ...c, archivedAt: "2026-11-04" }));
    const result = buildMonthBudgets("2026-11", "USD", [...archived, { ...cat("empty", 9), archivedAt: "2026-11-04" }], budgets, spend);
    expect(result.rows.map((r) => r.categoryId)).toEqual(["groceries", "transport", "fun"]);
    expect(result.totalLimitMinor).toBe(35000);
    expect(result.totalSpentMinor).toBe(35500);
  });

  it("never renders legacy child categories as independent budget rows", () => {
    const child = { ...cat("child", 8), parentId: "groceries", archivedAt: "2026-11-04" };
    const result = buildMonthBudgets("2026-11", "USD", [...categories, child], [...budgets, { categoryId: "child", currency: "USD", limitMinor: 999 }], spend);
    expect(result.rows.some((r) => r.categoryId === "child")).toBe(false);
    expect(result.totalLimitMinor).toBe(35000);
  });
});
