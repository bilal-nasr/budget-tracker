// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useAppData } from "@/components/providers/app-data";
import type { WalletContainer } from "@/features/wallets/schema";

const queries = vi.hoisted(() => ({ wallets: vi.fn(), currencies: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/wallets/queries", () => ({ getWallets: queries.wallets }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: queries.currencies }));
vi.mock("@/features/categories/queries", () => ({ getCategories: async () => [] }));
vi.mock("@/features/profile/queries", () => ({ getProfile: async () => ({ onboarded: true, digits: "latin", timezone: "Asia/Beirut", salary: null, usdLbpRate: null }) }));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/components/shell/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/shell/composer", () => ({ ComposerProvider: ({ children }: { children: React.ReactNode }) => children }));
import AppLayout from "./layout";

afterEach(cleanup);

function Probe() {
  const data = useAppData();
  return <output>{JSON.stringify({
    history: data.balanceById("old-jpy")?.currency,
    deleted: data.walletById("old")?.deleted,
    ordinary: data.walletContainers.map((wallet) => wallet.id),
  })}</output>;
}

it("loads complete history at the layout boundary while ordinary views exclude tombstones", async () => {
  const old: WalletContainer = {
    id: "old", name: "Closed", kind: "cash", position: 0, deleted: true, needsAttention: false,
    defaultBalanceId: "old-jpy",
    balances: [{ id: "old-jpy", walletId: "old", currency: "JPY", openingBalanceMinor: 0, balanceMinor: 0, detached: true, position: 0 }],
  };
  queries.currencies.mockResolvedValue([{ code: "JPY", symbol: "¥", decimalPlaces: 0, disabled: true, firstUsed: true }]);
  queries.wallets.mockImplementation(async (options) => options?.includeDeleted && options?.includeNeedsAttention && options?.includeDisabledBalances ? [old] : []);
  render(await AppLayout({ children: <Probe />, params: Promise.resolve({ locale: "en" }) }));
  expect(JSON.parse(screen.getByRole("status").textContent ?? "{}")).toEqual({ history: "JPY", deleted: true, ordinary: [] });
});
