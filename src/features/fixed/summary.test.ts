import { describe, expect, it } from "vitest";
import type { BalanceFixture as Wallet } from "@/test/balance-fixtures";
import type { FixedExpense } from "./schema";
import type { Installment } from "@/features/installments/schema";
import { summarizeFixed as summarizeWithCatalog } from "./summary";
import { withProgress } from "@/features/installments/cycle";

const wallet = (id: string, currency: string, balanceMinor: number, position: number): Wallet => ({
  id, name: id, kind: "cash", currency, openingBalanceMinor: 0, balanceMinor, position, archived: false,
});
const BANK = wallet("bank", "USD", 184630, 2);
const CASH_USD = wallet("cashUsd", "USD", 23000, 1);
const CASH_LBP = wallet("cashLbp", "LBP", 2450000, 3);
const CASH_SYP = wallet("cashSyp", "SYP", 5000, 4);
const byId = (id: string) => [BANK, CASH_USD, CASH_LBP, CASH_SYP].find((w) => w.id === id);

const item = (id: string, balanceId: string, amountMinor: number, paid = false): FixedExpense => ({
  id, name: id, amountMinor, balanceId: balanceId, categoryId: "c", dueDay: null, paidOn: paid ? "2026-11-01" : null,
});
const demo = [item("rent", "bank", 40000, true), item("net", "bank", 3000), item("gen", "cashUsd", 4500)];
const salary = { amountMinor: 180000, balanceId: "bank" };

describe("summarizeFixed", () => {
  it("totals, per-wallet needs and salary after fixed for the demo data", () => {
    const s = summarizeFixed(demo, byId, salary);
    expect(s.total).toEqual({ USD: 47500 });
    expect(s.left).toEqual({ USD: 7500 });
    expect(s.byBalance).toEqual([
      { balanceId: "cashUsd", currency: "USD", totalMinor: 4500, unpaidMinor: 4500, shortMinor: 0 },
      { balanceId: "bank", currency: "USD", totalMinor: 43000, unpaidMinor: 3000, shortMinor: 0 },
    ]);
    expect(s.salaryAfter).toEqual({ currency: "USD", minor: 132500, excludedCurrencies: [] });
  });

  it("never subtracts LBP items from a USD salary", () => {
    const s = summarizeFixed([...demo, item("sub", "cashLbp", 1200000)], byId, salary);
    expect(s.total.LBP).toBe(1200000);
    expect(s.salaryAfter).toEqual({ currency: "USD", minor: 132500, excludedCurrencies: ["LBP"] });
  });

  it("accounts for SYP independently and names both excluded currencies", () => {
    const items = [...demo, item("lbp", "cashLbp", 1000000), item("syp", "cashSyp", 1250)];
    const usd = summarizeFixed(items, byId, salary);
    expect(usd.total).toEqual({ USD: 47500, LBP: 1000000, SYP: 1250 });
    expect(usd.left.SYP).toBe(1250);
    expect(usd.salaryAfter?.excludedCurrencies).toEqual(["LBP", "SYP"]);
    const syp = summarizeFixed(items, byId, { amountMinor: 5000, balanceId: "cashSyp" });
    expect(syp.salaryAfter).toEqual({ currency: "SYP", minor: 3750, excludedCurrencies: ["USD", "LBP"] });
  });

  it("goes negative when the salary does not cover the fixed expenses", () => {
    const s = summarizeFixed(demo, byId, { amountMinor: 30000, balanceId: "bank" });
    expect(s.salaryAfter?.minor).toBe(-17500);
  });

  it("has no salary line without a salary", () => {
    expect(summarizeFixed(demo, byId, null).salaryAfter).toBeNull();
  });

  it("reports how much a wallet is short of its unpaid items", () => {
    const poor = wallet("cashUsd", "USD", 2000, 1);
    const s = summarizeFixed(demo, (id) => (id === "cashUsd" ? poor : byId(id)), salary);
    expect(s.byBalance[0].shortMinor).toBe(2500);
  });

  it("counts an installment's monthly amount on its default wallet", () => {
    const laptop: Installment = {
      id: "l", name: "Laptop", currency: "USD", balanceId: "bank", categoryId: "c",
      totalMinor: 120000, paidBeforeMinor: 0, monthlyMinor: 10000, dueDay: null,
      paidMinor: 30000, remainingMinor: 90000, paidThisCycleMinor: 10000, payments: [], salaryCycleId: "s1",
      cyclePaymentCount: 1, cycleLatestPaymentId: "p", cycleStatus: "paid",
    };
    const s = summarizeFixed(demo, byId, salary, [laptop]);
    expect(s.total.USD).toBe(57500);
    expect(s.left.USD).toBe(7500); // this month's installment payment is already made
    expect(s.byBalance.find((w) => w.balanceId === "bank")?.totalMinor).toBe(53000);
    expect(s.salaryAfter?.minor).toBe(122500);
  });

  it("keeps partial installment needs and resets only cycle contributions on another receipt", () => {
    const base = { id: "l", name: "Laptop", currency: "USD" as const, balanceId: "bank", categoryId: "c",
      totalMinor: 120000, paidBeforeMinor: 20000, monthlyMinor: 10000, dueDay: null };
    const payments = [{ transactionId: "p", amountMinor: 4000, occurredOn: "2026-10-01", createdAt: "2026-11-01T12:00:00Z", balanceId: "cashUsd", salaryCycleId: "s1", revision: 1 }];
    const partial = withProgress(base, payments, "s1");
    const before = summarizeFixed(demo, byId, salary, [partial]);
    expect(before.left.USD).toBe(13500);
    expect(before.total.USD).toBe(57500);
    const next = withProgress(base, payments, "s2");
    expect(next.remainingMinor).toBe(96000);
    expect(summarizeFixed(demo, byId, salary, [next]).left.USD).toBe(17500);
    const extra = withProgress(base, [{ ...payments[0], amountMinor: 25000 }], "s1");
    expect(summarizeFixed(demo, byId, salary, [extra]).total.USD).toBe(57500);
    expect(summarizeFixed(demo, byId, salary, [extra]).left.USD).toBe(7500);
  });

  it("is empty for no items", () => {
    const s = summarizeFixed([], byId, salary);
    expect(s.byBalance).toEqual([]);
    expect(s.salaryAfter?.minor).toBe(180000);
  });
});

function summarizeFixed(...args: [Parameters<typeof summarizeWithCatalog>[0], Parameters<typeof summarizeWithCatalog>[1], Parameters<typeof summarizeWithCatalog>[2], Parameters<typeof summarizeWithCatalog>[3]?]) {return summarizeWithCatalog(args[0],args[1],args[2],args[3]??[],["USD","LBP","SYP"]);}
it("orders excluded currencies by the catalog rather than encounter order",()=>{
 const result=summarizeWithCatalog([item("s","cashSyp",10),item("l","cashLbp",20)],byId,salary,[],["USD","LBP","SYP"]);
 expect(result.salaryAfter?.excludedCurrencies).toEqual(["LBP","SYP"]);
});
