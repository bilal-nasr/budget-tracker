import { beforeEach, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));
const getFixedExpenses = vi.fn();
const getWallets = vi.fn();
const getProfile = vi.fn();
const getCurrencies = vi.fn();
vi.mock("./queries", () => ({ getFixedExpenses: (...args: unknown[]) => getFixedExpenses(...args) }));
vi.mock("@/features/wallets/queries", () => ({ getWallets: (...args: unknown[]) => getWallets(...args) }));
vi.mock("@/features/profile/queries", () => ({ getProfile: () => getProfile() }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
import { fixedTools } from "./mcp";

type Out = { expenses: Record<string, unknown>[] };
const wallet = (balances: { id: string; currency: string }[]) => ({ id: "w1", balances });

beforeEach(() => {
  vi.resetAllMocks();
  getProfile.mockResolvedValue({ timezone: "Asia/Beirut" });
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
  getWallets.mockResolvedValue([wallet([{ id: "b1", currency: "USD" }, { id: "b2", currency: "LBP" }])]);
});

test("fixed_expenses_list passes the timezone and adds amounts in the paying balance's currency, items included", async () => {
  getFixedExpenses.mockResolvedValue([
    { id: "f1", name: "Rent", amountMinor: 30000, balanceId: "b1", categoryId: "c1", dueDay: 5, paidOn: null, items: [{ description: "Base", amountMinor: 25000 }] },
    { id: "f2", name: "Generator", amountMinor: 1500000, balanceId: "b2", categoryId: "c1", dueDay: null, paidOn: "2026-11-02" },
  ]);
  const [tool] = fixedTools;
  expect(tool.name).toBe("fixed_expenses_list");
  expect(tool.kind).toBe("read");
  const out = (await tool.run({})) as Out;
  expect(getFixedExpenses).toHaveBeenCalledWith("Asia/Beirut");
  expect(out.expenses[0]).toMatchObject({
    amountMinor: 30000, currency: "USD", amount: { minor: 30000, currency: "USD", text: "$300.00" },
    items: [{ amountMinor: 25000, amount: { minor: 25000, currency: "USD", text: "$250.00" } }],
  });
  expect(out.expenses[1]).toMatchObject({ amount: { minor: 1500000, currency: "LBP", text: "LBP 1,500,000" } });
  expect(out.expenses[1]).not.toHaveProperty("items");
});

test("an unresolvable balance leaves the expense raw", async () => {
  getFixedExpenses.mockResolvedValue([{ id: "f1", name: "Old", amountMinor: 100, balanceId: "gone", categoryId: "c1", dueDay: null, paidOn: null }]);
  const out = (await fixedTools[0].run({})) as Out;
  expect(out.expenses[0]).toEqual({ id: "f1", name: "Old", amountMinor: 100, balanceId: "gone", categoryId: "c1", dueDay: null, paidOn: null });
});

test("fixed_expenses_list describes paidOn as the query computes it", () => {
  const { description } = fixedTools[0];
  // Newest payment recorded since the latest salary receipt was recorded; with no salary yet, this calendar month.
  expect(description).toMatch(/since the latest salary/i);
  expect(description).toMatch(/calendar month/i);
  expect(description).toMatch(/newest/i);
});
