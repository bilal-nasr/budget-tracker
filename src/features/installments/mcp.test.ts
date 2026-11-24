import { beforeEach, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));
const getInstallments = vi.fn();
const getProfile = vi.fn();
const getCurrencies = vi.fn();
vi.mock("./queries", () => ({ getInstallments: (...args: unknown[]) => getInstallments(...args) }));
vi.mock("@/features/profile/queries", () => ({ getProfile: () => getProfile() }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
import { installmentTools } from "./mcp";

type Out = { installments: Record<string, unknown>[] };

beforeEach(() => {
  vi.resetAllMocks();
  getProfile.mockResolvedValue({ timezone: "Asia/Beirut" });
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
});

test("installments_list adds amounts for every figure and leaves out the never-filled payment history", async () => {
  getInstallments.mockResolvedValue([{
    id: "i1", name: "Laptop", currency: "USD", balanceId: "b1", categoryId: "c1", totalMinor: 120000, paidBeforeMinor: 10000,
    monthlyMinor: 20000, dueDay: 3, paidMinor: 30000, remainingMinor: 90000, salaryCycleId: "s1", paidThisCycleMinor: 20000,
    cyclePaymentCount: 1, cycleLatestPaymentId: "t1", cycleStatus: "paid",
    // What getCycleSummary really returns: no history, flagged incomplete.
    payments: [], historyComplete: false,
  }, {
    id: "i2", name: "Open", currency: "LBP", balanceId: "b2", categoryId: "c1", totalMinor: 900000, paidBeforeMinor: 0,
    monthlyMinor: null, dueDay: null, paidMinor: 0, remainingMinor: 900000, salaryCycleId: null, paidThisCycleMinor: 0,
    cyclePaymentCount: 0, cycleLatestPaymentId: null, cycleStatus: "unpaid", payments: [], historyComplete: false,
  }]);
  const [tool] = installmentTools;
  expect(tool.name).toBe("installments_list");
  expect(tool.kind).toBe("read");
  const out = (await tool.run({})) as Out;
  expect(getInstallments).toHaveBeenCalledWith("Asia/Beirut");
  const first = out.installments[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(first.totalMinor).toBe(120000);
  expect(first.total).toEqual({ minor: 120000, currency: "USD", text: "$1,200.00" });
  expect(first.paidBefore.text).toBe("$100.00");
  expect(first.monthly.text).toBe("$200.00");
  expect(first.paid.text).toBe("$300.00");
  expect(first.remaining.text).toBe("$900.00");
  expect(first.paidThisCycle.text).toBe("$200.00");
  for (const installment of out.installments) {
    expect(installment).not.toHaveProperty("payments");
    expect(installment).not.toHaveProperty("historyComplete");
  }
  expect(first).toMatchObject({ cyclePaymentCount: 1, cycleLatestPaymentId: "t1", cycleStatus: "paid" });
  expect(out.installments[1]).toMatchObject({ monthly: null, total: { currency: "LBP", text: "LBP 900,000" } });
});

test("installments_list does not promise a payment history it never returns", () => {
  const [tool] = installmentTools;
  expect(tool.description).not.toMatch(/every recorded payment|newest first/i);
  expect(tool.description).toMatch(/paid so far/i);
  expect(tool.description).toMatch(/remaining/i);
});
