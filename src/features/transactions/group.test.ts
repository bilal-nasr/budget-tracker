import { describe, expect, it } from "vitest";
import { addDays, groupByDay, todayIn } from "./group";
import type { Transaction } from "./schema";

const tx = (over: Partial<Transaction>): Transaction => ({
  id: "00000000-0000-4000-8000-000000000001",
  kind: "expense",
  occurredOn: "2026-11-03",
  amountMinor: 1000,
  currency: "USD",
  walletId: "00000000-0000-4000-8000-0000000000aa",
  categoryId: "00000000-0000-4000-8000-0000000000bb",
  note: null,
  createdAt: "2026-11-03T10:00:00Z",
  ...over,
});

describe("groupByDay", () => {
  it("groups by date and totals each currency separately", () => {
    const groups = groupByDay([
      tx({ amountMinor: 5420 }),
      tx({ amountMinor: 400000, currency: "LBP" }),
      tx({ kind: "income", amountMinor: 180000, occurredOn: "2026-11-02" }),
      tx({ amountMinor: 4500, occurredOn: "2026-11-02" }),
    ]);
    expect(groups.map((g) => g.date)).toEqual(["2026-11-03", "2026-11-02"]);
    expect(groups[0].totals).toEqual({ USD: -5420, LBP: -400000 });
    expect(groups[1].totals).toEqual({ USD: 175500, LBP: 0 });
  });
});

describe("dates", () => {
  it("adds days across month ends", () => {
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("reads today in the owner's timezone", () => {
    // 22:30 UTC on Nov 3 is already Nov 4 in Beirut (UTC+2).
    expect(todayIn("Asia/Beirut", new Date("2026-11-03T22:30:00Z"))).toBe("2026-11-04");
    expect(todayIn("UTC", new Date("2026-11-03T22:30:00Z"))).toBe("2026-11-03");
  });
});
