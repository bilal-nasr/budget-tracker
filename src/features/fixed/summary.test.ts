import { describe, expect, it } from "vitest";
import type { Wallet } from "@/features/wallets/schema";
import type { FixedExpense } from "./schema";
import type { Installment } from "@/features/installments/schema";
import { summarizeFixed } from "./summary";

const wallet = (id: string, currency: "USD" | "LBP", balanceMinor: number, position: number): Wallet => ({
  id, name: id, kind: "cash", currency, openingBalanceMinor: 0, balanceMinor, position, archived: false,
});
const BANK = wallet("bank", "USD", 184630, 2);
const CASH_USD = wallet("cashUsd", "USD", 23000, 1);
const CASH_LBP = wallet("cashLbp", "LBP", 2450000, 3);
const byId = (id: string) => [BANK, CASH_USD, CASH_LBP].find((w) => w.id === id);

const item = (id: string, walletId: string, amountMinor: number, paid = false): FixedExpense => ({
  id, name: id, amountMinor, walletId, categoryId: "c", dueDay: null, paidOn: paid ? "2026-11-01" : null,
});
const demo = [item("rent", "bank", 40000, true), item("net", "bank", 3000), item("gen", "cashUsd", 4500)];
const salary = { amountMinor: 180000, walletId: "bank" };

describe("summarizeFixed", () => {
  it("totals, per-wallet needs and salary after fixed for the demo data", () => {
    const s = summarizeFixed(demo, byId, salary);
    expect(s.total).toEqual({ USD: 47500, LBP: 0 });
    expect(s.left).toEqual({ USD: 7500, LBP: 0 });
    expect(s.byWallet).toEqual([
      { walletId: "cashUsd", currency: "USD", totalMinor: 4500, unpaidMinor: 4500, shortMinor: 0 },
      { walletId: "bank", currency: "USD", totalMinor: 43000, unpaidMinor: 3000, shortMinor: 0 },
    ]);
    expect(s.salaryAfter).toEqual({ currency: "USD", minor: 132500, excludesOther: false });
  });

  it("never subtracts LBP items from a USD salary", () => {
    const s = summarizeFixed([...demo, item("sub", "cashLbp", 1200000)], byId, salary);
    expect(s.total.LBP).toBe(1200000);
    expect(s.salaryAfter).toEqual({ currency: "USD", minor: 132500, excludesOther: true });
  });

  it("goes negative when the salary does not cover the fixed expenses", () => {
    const s = summarizeFixed(demo, byId, { amountMinor: 30000, walletId: "bank" });
    expect(s.salaryAfter?.minor).toBe(-17500);
  });

  it("has no salary line without a salary", () => {
    expect(summarizeFixed(demo, byId, null).salaryAfter).toBeNull();
  });

  it("reports how much a wallet is short of its unpaid items", () => {
    const poor = wallet("cashUsd", "USD", 2000, 1);
    const s = summarizeFixed(demo, (id) => (id === "cashUsd" ? poor : byId(id)), salary);
    expect(s.byWallet[0].shortMinor).toBe(2500);
  });

  it("counts an installment's monthly amount on its default wallet", () => {
    const laptop: Installment = {
      id: "l", name: "Laptop", currency: "USD", walletId: "bank", categoryId: "c",
      totalMinor: 120000, paidBeforeMinor: 0, monthlyMinor: 10000, dueDay: null,
      paidMinor: 30000, remainingMinor: 90000, paidThisMonthMinor: 10000, payments: [],
    };
    const s = summarizeFixed(demo, byId, salary, [laptop]);
    expect(s.total.USD).toBe(57500);
    expect(s.left.USD).toBe(7500); // this month's installment payment is already made
    expect(s.byWallet.find((w) => w.walletId === "bank")?.totalMinor).toBe(53000);
    expect(s.salaryAfter?.minor).toBe(122500);
  });

  it("is empty for no items", () => {
    const s = summarizeFixed([], byId, salary);
    expect(s.byWallet).toEqual([]);
    expect(s.salaryAfter?.minor).toBe(180000);
  });
});
