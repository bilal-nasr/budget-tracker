import { requireCurrency, SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
import { describe, expect, it } from "vitest";
import { MAX_MINOR } from "@/lib/money";
import {
  expenseItemInputSchema,
  MAX_EXPENSE_ITEMS,
  parseExpenseItemDrafts,
  summarizeBreakdown,
  type ExpenseItemDraft,
  type ExpenseItem,
} from "./breakdown";
import { isExpenseItemInput } from "./breakdown-summary";

const item = (amountMinor: number) => ({ description: "Phone credits", amountMinor });
const draft = (amountText = "20", description = "Phone credits"): ExpenseItemDraft => ({
  key: "line-one", description, amountText,
});

describe("expense item input", () => {
  it("trims a description and accepts exact minor units", () => {
    expect(expenseItemInputSchema.parse({ description: "  Phone credits  ", amountMinor: 2000 }))
      .toEqual(item(2000));
  });

  it.each(["", " \n\t ", "a".repeat(141)])("rejects an invalid description %j", (description) => {
    expect(expenseItemInputSchema.safeParse({ description, amountMinor: 1 }).success).toBe(false);
  });

  it.each([0, -1, 0.5, MAX_MINOR + 1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])
    ("rejects invalid amount %s", (amountMinor) => {
      expect(expenseItemInputSchema.safeParse(item(amountMinor)).success).toBe(false);
    });

  it("rejects financial ownership, currency and hierarchy on a descriptive item", () => {
    for (const key of ["userId", "balanceId", "currency", "items", "parentId", "categoryId"]) {
      expect(expenseItemInputSchema.safeParse({ ...item(1), [key]: "forged" }).success).toBe(false);
    }
  });
});

describe("zod-free item check", () => {
  // summarizeBreakdown ships to Home without zod; it must agree with the schema.
  it.each([
    ["Phone credits", 1], ["  Phone credits  ", 2000], ["a".repeat(140), MAX_MINOR], [" a".repeat(70), 5],
    ["", 1], [" \n\t ", 1], ["a".repeat(141), 1], [" x ", 1], ["Phone", 0], ["Phone", -1], ["Phone", 0.5],
    ["Phone", MAX_MINOR + 1], ["Phone", Number.MAX_SAFE_INTEGER + 1], ["Phone", Infinity], ["Phone", NaN],
  ])("matches expenseItemInputSchema for %j / %s", (description, amountMinor) => {
    expect(isExpenseItemInput({ description, amountMinor }))
      .toBe(expenseItemInputSchema.safeParse({ description, amountMinor }).success);
  });
});

describe("summarizeBreakdown", () => {
  it("allows empty, partial and complete itemization without changing parent cost", () => {
    expect(summarizeBreakdown(5000, [])).toEqual({ valid: true, itemizedMinor: 0, remainderMinor: 5000 });
    expect(summarizeBreakdown(5000, [item(2000)]))
      .toEqual({ valid: true, itemizedMinor: 2000, remainderMinor: 3000 });
    expect(summarizeBreakdown(5000, [item(2000), item(3000)]))
      .toEqual({ valid: true, itemizedMinor: 5000, remainderMinor: 0 });
  });

  it("also summarizes persisted items carrying read-only identity and order", () => {
    const saved: ExpenseItem = { ...item(2000), id: "saved-line", position: 0 };
    expect(summarizeBreakdown(5000, [saved]))
      .toEqual({ valid: true, itemizedMinor: 2000, remainderMinor: 3000 });
  });

  it("rejects a one-cent excess and recalculates after parent reduction", () => {
    expect(summarizeBreakdown(5000, [item(2000), item(3001)]))
      .toEqual({ valid: false, reason: "exceedsParent" });
    expect(summarizeBreakdown(1999, [item(2000)]).valid).toBe(false);
  });

  it("keeps large sums exact even when the possible sum exceeds safe Number range", () => {
    expect(summarizeBreakdown(MAX_MINOR, [item(MAX_MINOR)]))
      .toEqual({ valid: true, itemizedMinor: MAX_MINOR, remainderMinor: 0 });
    expect(summarizeBreakdown(MAX_MINOR, Array.from({ length: MAX_EXPENSE_ITEMS }, () => item(MAX_MINOR))))
      .toEqual({ valid: false, reason: "exceedsParent" });
  });

  it("refuses invalid parents, amounts and more than 50 items without throwing", () => {
    for (const amount of [0, -1, 0.1, NaN, MAX_MINOR + 1]) {
      expect(summarizeBreakdown(amount, []).valid).toBe(false);
    }
    expect(summarizeBreakdown(5000, [item(0.5)]).valid).toBe(false);
    expect(summarizeBreakdown(5000, Array.from({ length: 51 }, () => item(1))).valid).toBe(false);
  });
});

describe("parseExpenseItemDrafts", () => {
  it("parses Arabic-Indic money through the currency money parser", () => {
    expect(parseExpenseItemDrafts(requireCurrency("USD", SEED_CURRENCY_DEFINITIONS), 5000, [draft("٢٠٫٠٠", "  رصيد الهاتف  ")]))
      .toEqual({
        valid: true,
        items: [{ description: "رصيد الهاتف", amountMinor: 2000 }],
        summary: { valid: true, itemizedMinor: 2000, remainderMinor: 3000 },
      });
    expect(parseExpenseItemDrafts(requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS), 5000, [draft("١٬٢٠٠")]).valid).toBe(true);
    expect(parseExpenseItemDrafts(requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS), 5000, [draft("1.5")]).valid).toBe(false);
  });

  it("never silently drops a blank, incomplete, zero or invalid line", () => {
    for (const row of [draft(""), draft("20", " "), draft("0"), draft("1."), draft("-20"), draft("1e2")]) {
      expect(parseExpenseItemDrafts(requireCurrency("USD", SEED_CURRENCY_DEFINITIONS), 5000, [draft(), { ...row, key: "two" }]))
        .toMatchObject({ valid: false, reason: "invalidItem" });
    }
  });

  it("recomputes parent validity, remainder, excess and the item limit", () => {
    expect(parseExpenseItemDrafts(requireCurrency("USD", SEED_CURRENCY_DEFINITIONS), null, []).valid).toBe(false);
    expect(parseExpenseItemDrafts(requireCurrency("USD", SEED_CURRENCY_DEFINITIONS), 3000, [draft()])).toMatchObject({
      valid: true, summary: { remainderMinor: 1000 },
    });
    expect(parseExpenseItemDrafts(requireCurrency("USD", SEED_CURRENCY_DEFINITIONS), 1000, [draft()]))
      .toEqual({ valid: false, reason: "exceedsParent" });
    expect(parseExpenseItemDrafts(requireCurrency("USD", SEED_CURRENCY_DEFINITIONS), 5000, Array.from({ length: 51 }, (_, i) => ({
      ...draft("0.01"), key: String(i),
    }))).valid).toBe(false);
  });
});
