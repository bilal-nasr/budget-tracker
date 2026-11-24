import { beforeEach, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));
const getWallets = vi.fn();
const getCurrencies = vi.fn();
vi.mock("./queries", () => ({ getWallets: () => getWallets() }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
import { walletTools } from "./mcp";

const balance = (id: string, currency: string, balanceMinor: number) => ({
  id, walletId: "w1", currency, openingBalanceMinor: 0, balanceMinor, position: 0, detached: false,
});

beforeEach(() => {
  getWallets.mockReset();
  getCurrencies.mockReset();
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
});

test("wallets_list adds amount to every balance and keeps raw fields", async () => {
  getWallets.mockResolvedValue([{
    id: "w1", name: "Pocket", kind: "cash", position: 0, deleted: false, needsAttention: false, defaultBalanceId: "b1",
    balances: [balance("b1", "USD", 1250), balance("b2", "LBP", 4250000)],
  }]);
  const [tool] = walletTools;
  expect(tool.name).toBe("wallets_list");
  expect(tool.kind).toBe("read");
  const out = (await tool.run({})) as { wallets: { balances: Record<string, unknown>[] }[] };
  expect(out.wallets[0].balances[0]).toMatchObject({ balanceMinor: 1250, amount: { minor: 1250, currency: "USD", text: "$12.50" } });
  expect(out.wallets[0].balances[1]).toMatchObject({ amount: { minor: 4250000, currency: "LBP", text: "LBP 4,250,000" } });
});

test("an unknown currency keeps raw fields and omits text", async () => {
  getWallets.mockResolvedValue([{
    id: "w1", name: "Old", kind: "cash", position: 0, deleted: false, needsAttention: false, defaultBalanceId: "b1",
    balances: [balance("b1", "EUR", 500)],
  }]);
  const out = (await walletTools[0].run({})) as { wallets: { balances: { amount: unknown }[] }[] };
  expect(out.wallets[0].balances[0].amount).toEqual({ minor: 500, currency: "EUR" });
});
