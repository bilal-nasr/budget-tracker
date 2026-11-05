import { describe, expect, it } from "vitest";
import { budgetEditSchema } from "./schema";

describe("budget currency validation", () => {
  const input = { month: "2026-11", currency: "SYP", limits: [{ categoryId: "00000000-0000-4000-8000-000000000001", limitMinor: 1250 }] };
  it("accepts integer SYP whole pounds and rejects malformed currency codes", () => {
    expect(budgetEditSchema.safeParse(input).success).toBe(true);
    expect(budgetEditSchema.safeParse({ ...input, currency: "invalid-code" }).success).toBe(false);
  });
});
