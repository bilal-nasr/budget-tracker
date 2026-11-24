import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrencies, getSalaryReceiptDates, getMonthBudgets } = vi.hoisted(() => ({ getCurrencies: vi.fn(), getSalaryReceiptDates: vi.fn(), getMonthBudgets: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies }));
vi.mock("./queries", () => ({ getSalaryReceiptDates, getMonthBudgets }));

import { buildCycles, pickCycle } from "./cycles";
import { getSpendingSummary } from "./summary";
import { todayIn } from "@/features/transactions/group";

const cur = (code: string, disabled = false) => ({ code, symbol: code, decimalPlaces: 2, disabled, firstUsed: true });
const TZ = "Asia/Beirut";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrencies.mockResolvedValue([cur("USD"), cur("LBP"), cur("SYP", true)]);
  getMonthBudgets.mockImplementation(async (month: string, currency: string) => ({ month, currency, totalLimitMinor: 0 }));
});

describe("getSpendingSummary", () => {
  it("has no salary cycle without receipts and uses the current calendar month", async () => {
    getSalaryReceiptDates.mockResolvedValue([]);
    const s = await getSpendingSummary(TZ);
    expect(s.salaryCycle).toBeNull();
    expect(s.calendarMonth?.month).toBe(todayIn(TZ).slice(0, 7));
    expect(s.calendarMonth?.budgets.map((b) => b.currency)).toEqual(["USD", "LBP"]);
  });

  it("builds the salary cycle from receipts and queries it with the cycle range", async () => {
    const dates = ["2026-10-05", "2026-11-05"];
    getSalaryReceiptDates.mockResolvedValue(dates);
    const cycle = pickCycle(buildCycles(dates), null)!;
    const s = await getSpendingSummary(TZ);
    expect(s.salaryCycle?.cycle).toEqual(cycle);
    expect(getMonthBudgets).toHaveBeenCalledWith(cycle.from.slice(0, 7), "USD", cycle);
    expect(getMonthBudgets).toHaveBeenCalledWith(cycle.from.slice(0, 7), "LBP", cycle);
    expect(s.salaryCycle?.budgets.map((b) => b.currency)).toEqual(["USD", "LBP"]);
  });

  it("skips disabled currencies", async () => {
    getSalaryReceiptDates.mockResolvedValue(["2026-11-05"]);
    await getSpendingSummary(TZ);
    expect(getMonthBudgets.mock.calls.some((c) => c[1] === "SYP")).toBe(false);
  });

  it("only: active fetches just the salary cycle when one exists", async () => {
    getSalaryReceiptDates.mockResolvedValue(["2026-11-05"]);
    const s = await getSpendingSummary(TZ, "active");
    expect(s.salaryCycle).not.toBeNull();
    expect(s.calendarMonth).toBeNull();
    expect(getMonthBudgets).toHaveBeenCalledTimes(2);
  });

  it("only: active fetches the calendar month when there is no cycle", async () => {
    getSalaryReceiptDates.mockResolvedValue([]);
    const s = await getSpendingSummary(TZ, "active");
    expect(s.salaryCycle).toBeNull();
    expect(s.calendarMonth?.budgets).toHaveLength(2);
  });

  it("without only fetches both halves", async () => {
    getSalaryReceiptDates.mockResolvedValue(["2026-11-05"]);
    const s = await getSpendingSummary(TZ);
    expect(s.salaryCycle).not.toBeNull();
    expect(s.calendarMonth).not.toBeNull();
    expect(getMonthBudgets).toHaveBeenCalledTimes(4);
  });
});
