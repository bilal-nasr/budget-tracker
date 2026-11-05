import { describe, expect, it } from "vitest";
import { fixedInputSchema } from "./schema";

const input = { name: "Household", amountMinor: 5000,
  balanceId: "00000000-0000-4000-8000-000000000001",
  categoryId: "00000000-0000-4000-8000-000000000002", dueDay: null };

describe("fixed expense breakdown", () => {
  it("retains normalized partial items and defaults old inputs to an empty breakdown", () => {
    expect(fixedInputSchema.parse({ ...input, items: [{ description: " Internet ", amountMinor: 2000 }] }).items)
      .toEqual([{ description: "Internet", amountMinor: 2000 }]);
    expect(fixedInputSchema.parse(input).items).toEqual([]);
  });
  it("rejects excess totals, invalid lines, and more than fifty items", () => {
    for (const items of [
      [{ description: "Internet", amountMinor: 5001 }],
      [{ description: "", amountMinor: 100 }],
      [{ description: "Internet", amountMinor: 0 }],
      Array.from({ length: 51 }, () => ({ description: "Item", amountMinor: 1 })),
    ]) expect(fixedInputSchema.safeParse({ ...input, items }).success).toBe(false);
  });
});
