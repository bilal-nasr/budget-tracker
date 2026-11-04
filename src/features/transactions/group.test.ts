import { describe, expect, it } from "vitest";
import { addDays, groupByDay, todayIn } from "./group";
import { emptyTransactionMetadata, type Transaction } from "./schema";

const tx = (over: Partial<Transaction>): Transaction => ({
  ...emptyTransactionMetadata(),
  id: "00000000-0000-4000-8000-000000000001",
  kind: "expense",
  occurredOn: "2026-11-03",
  amountMinor: 1000,
  currency: "USD",
  walletId: "00000000-0000-4000-8000-0000000000aa",
  categoryId: "00000000-0000-4000-8000-0000000000bb",
  toWalletId: null,
  toAmountMinor: null,
  note: null,
  createdAt: "2026-11-03T10:00:00Z",
  ...over,
});

describe("groupByDay", () => {
  it("counts purchase cost once while cashier tender and foreign change remain wallet movements", () => {
    const groups = groupByDay([tx({ amountMinor: 1250, settlement: { tenderMinor: 2000,
      change: { walletId: "00000000-0000-4000-8000-000000000003", currency: "LBP", amountMinor: 671250,
        rate: { base: "USD", quote: "LBP", quoteMajorNumerator: 89500, quoteMajorDenominator: 1 } },
    } })]);
    expect(groups[0].totals).toEqual({ USD: -1250, LBP: 0, SYP: 0 });
    expect(groups[0].rows).toHaveLength(1);
  });
  it("counts one parent cost when its optional breakdown has two amounts", () => {
    const groups = groupByDay([tx({ amountMinor: 5000, items: [
      { id: "one", description: "Phone credits", amountMinor: 2000, position: 0 },
      { id: "two", description: "For sister", amountMinor: 3000, position: 1 },
    ] })]);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].totals.USD).toBe(-5000);
  });
  it("groups by date and totals each currency separately", () => {
    const groups = groupByDay([
      tx({ amountMinor: 5420 }),
      tx({ amountMinor: 400000, currency: "LBP" }),
      tx({ kind: "income", amountMinor: 180000, occurredOn: "2026-11-02" }),
      tx({ amountMinor: 4500, occurredOn: "2026-11-02" }),
    ]);
    expect(groups.map((g) => g.date)).toEqual(["2026-11-03", "2026-11-02"]);
    expect(groups[0].totals).toEqual({ USD: -5420, LBP: -400000, SYP: 0 });
    expect(groups[1].totals).toEqual({ USD: 175500, LBP: 0, SYP: 0 });
  });
  it("keeps SYP income/spending separate and excludes its transfers", () => {
    const groups = groupByDay([
      tx({ currency: "SYP", amountMinor: 1250 }),
      tx({ currency: "SYP", kind: "income", amountMinor: 250 }),
      tx({ currency: "SYP", kind: "transfer", amountMinor: 500, toAmountMinor: 500 }),
      tx({ currency: "USD", amountMinor: 100 }),
    ]);
    expect(groups[0].totals).toEqual({ USD: -100, LBP: 0, SYP: -1000 });
  });
});

describe("groupByDay with moves", () => {
  it("does not count a move between wallets as income or spending", () => {
    const groups = groupByDay([
      tx({ kind: "transfer", amountMinor: 20000, categoryId: null, toWalletId: "00000000-0000-4000-8000-0000000000cc", toAmountMinor: 20000 }),
      tx({ amountMinor: 500 }),
    ]);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].totals).toEqual({ USD: -500, LBP: 0, SYP: 0 });
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
