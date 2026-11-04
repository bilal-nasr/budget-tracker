import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ configured: vi.fn(), createClient: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/demo-data", () => ({ DEMO_WALLETS: [] }));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { getWallets } from "./queries";
import { MoneyRangeError } from "@/lib/money";

let balance: { data: { wallet_id: string; balance_minor: string }[] | null; error: { message: string } | null };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.configured.mockReturnValue(true);
  balance = { data: [{ wallet_id: "syp", balance_minor: "-1250" }], error: null };
  const query = { select: vi.fn().mockReturnThis(), order: vi.fn() };
  query.order.mockReturnValueOnce(query).mockResolvedValueOnce({ data: [{ id: "syp", name: "Synthetic", kind: "cash", currency: "SYP", opening_balance_minor: "2500", position: 1, archived_at: null }], error: null });
  mocks.from.mockImplementation((table: string) => table === "wallets" ? query : { select: () => Promise.resolve(balance) });
  mocks.createClient.mockResolvedValue({ from: mocks.from });
});
it("reads a signed SYP balance without rescaling whole pounds", async () => {
  expect(await getWallets()).toEqual([expect.objectContaining({ currency: "SYP", balanceMinor: -1250, openingBalanceMinor: 2500 })]);
});
it("rejects an out-of-domain aggregate before Number conversion", async () => {
  balance.data![0].balance_minor = "9007199254740993";
  await expect(getWallets()).rejects.toThrow(MoneyRangeError);
});
it("does not replace a failed balance query with a misleading opening balance", async () => {
  balance = { data: null, error: { message: "synthetic failure" } };
  await expect(getWallets()).rejects.toThrow("Wallet balances unavailable");
});
