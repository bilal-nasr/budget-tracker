import { describe, expect, it } from "vitest";
import { budgetEditSchema } from "./schema";
import { buildMonthBudgets } from "./rows";
import { parseExpenseItemDrafts } from "@/features/transactions/breakdown";
const custom = { code: "TOKEN8", symbol: "T", decimalPlaces: 8, disabled: false, firstUsed: true };
describe("runtime money families", () => {
  it("budgets accept catalog codes outside built-ins", () => {
    expect(budgetEditSchema.safeParse({ month: "2026-11", currency: custom.code, limits: [] }).success).toBe(true);
    expect(buildMonthBudgets("2026-11", custom.code, [], [], []).currency).toBe(custom.code);
  });
  it("itemized amounts retain every minor unit at precision eight", () => {
    expect(parseExpenseItemDrafts(custom, 123456789, [{ key: "a", description: "part", amountText: "1.23456788" }])).toMatchObject({valid: true, items: [{amountMinor: 123456788}], summary: {remainderMinor: 1}});
  });
});
