/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));
const getMonthBudgets = vi.fn();
const getSpendingSummary = vi.fn();
const getProfile = vi.fn();
const getCurrencies = vi.fn();
vi.mock("./queries", () => ({ getMonthBudgets: (...args: unknown[]) => getMonthBudgets(...args) }));
vi.mock("./summary", () => ({ getSpendingSummary: (...args: unknown[]) => getSpendingSummary(...args) }));
vi.mock("@/features/profile/queries", () => ({ getProfile: () => getProfile() }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
import { budgetTools } from "./mcp";

const tool = (name: string) => budgetTools.find((t) => t.name === name)!;
const budgets = (month: string, currency: string) => ({
  month, currency, totalLimitMinor: 10000, totalSpentMinor: 2500,
  rows: [{ categoryId: "c1", limitMinor: 10000, spentMinor: 2500, leftMinor: 7500, progress: 0.25 }],
});

beforeEach(() => {
  vi.resetAllMocks();
  getProfile.mockResolvedValue({ timezone: "Asia/Beirut" });
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
});

test("budgets_get passes month and currency and adds amounts", async () => {
  getMonthBudgets.mockResolvedValue(budgets("2026-10", "USD"));
  expect(tool("budgets_get").kind).toBe("read");
  const out = (await tool("budgets_get").run({ month: "2026-10", currency: "USD" })) as Record<string, any>;
  expect(getMonthBudgets).toHaveBeenCalledWith("2026-10", "USD");
  expect(out.totalSpentMinor).toBe(2500);
  expect(out.totalSpent).toEqual({ minor: 2500, currency: "USD", text: "$25.00" });
  expect(out.rows[0].left).toEqual({ minor: 7500, currency: "USD", text: "$75.00" });
});

test("budgets_get defaults the month to the current month in the profile timezone", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-24T12:00:00Z"));
  getMonthBudgets.mockResolvedValue(budgets("2026-11", "LBP"));
  await tool("budgets_get").run({ currency: "LBP" });
  expect(getMonthBudgets).toHaveBeenCalledWith("2026-11", "LBP");
  vi.useRealTimers();
});

test("budgets_get validates month format", () => {
  const input = tool("budgets_get").input!;
  expect(input.safeParse({ month: "2026-13", currency: "USD" }).success).toBe(false);
  expect(input.safeParse({ currency: "USD" }).success).toBe(true);
});

test("summary_get labels both periods and has no cross-currency total", async () => {
  getSpendingSummary.mockResolvedValue({
    calendarMonth: { month: "2026-11", budgets: [budgets("2026-11", "USD"), budgets("2026-11", "LBP")] },
    salaryCycle: { cycle: { from: "2026-11-05", to: null }, budgets: [budgets("2026-11", "USD")] },
  });
  const out = (await tool("summary_get").run({})) as Record<string, any>;
  expect(getSpendingSummary).toHaveBeenCalledWith("Asia/Beirut");
  expect(out.calendarMonth.month).toBe("2026-11");
  expect(out.salaryCycle.cycle).toEqual({ from: "2026-11-05", to: null });
  expect(out.calendarMonth.budgets).toHaveLength(2);
  expect(out.calendarMonth.budgets[0].totalSpent.text).toBe("$25.00");
  expect(out.calendarMonth.budgets[1].totalSpent.text).toBe("LBP 2,500");
  expect(Object.keys(out.calendarMonth).sort()).toEqual(["budgets", "month"]);
  expect(Object.keys(out).sort()).toEqual(["calendarMonth", "salaryCycle"]);
});

test("summary_get keeps salaryCycle null without a salary", async () => {
  getSpendingSummary.mockResolvedValue({ calendarMonth: { month: "2026-11", budgets: [] }, salaryCycle: null });
  const out = (await tool("summary_get").run({})) as Record<string, unknown>;
  expect(out.salaryCycle).toBeNull();
});
