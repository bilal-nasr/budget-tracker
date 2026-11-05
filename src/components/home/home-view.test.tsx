// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { AppDataProvider } from "@/components/providers/app-data";
import { HomeView, HomeCommitments } from "./home-view";
vi.mock("@/components/shell/composer", () => ({ useComposer: () => ({ openWallet: vi.fn() }) }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), Link: ({ children, href }: { children: React.ReactNode; href: string | { pathname: string; query: Record<string, string> } }) => <a href={typeof href === "string" ? href : `${href.pathname}?${new URLSearchParams(href.query)}`}>{children}</a> }));
vi.mock("@/components/shell/screen-header", () => ({ ScreenHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }));
vi.mock("server-only", () => ({}));
afterEach(cleanup);
it("shows a custom-default wallet's exact balance without a legacy fallback or combined total", () => {
 render(<NextIntlClientProvider locale="en" messages={en}><AppDataProvider currencies={[{ code: "TOKEN", symbol: "◈", decimalPlaces: 8, disabled: false, firstUsed: true }]} walletContainers={[{ id: "wallet", name: "Custom", kind: "cash", position: 0, deleted: false, needsAttention: false, defaultBalanceId: "balance", balances: [{ id: "balance", walletId: "wallet", currency: "TOKEN", openingBalanceMinor: 0, balanceMinor: 123456789, position: 0, detached: false }] }]} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}><HomeView recent={null} commitments={<HomeCommitments salaryStatus={{ receiptId: null, lastReceivedOn: null, receivedThisMonth: false }} fixed={[]} installments={[]} cycleUnavailable={true} />} budgetSummary={null} /></AppDataProvider></NextIntlClientProvider>);
 expect(screen.getAllByText("◈1.23456789")).toHaveLength(2);
 expect(screen.getByRole("link", { name: /Custom/ }).getAttribute("href")).toBe("/activity?balanceId=balance");
 expect(screen.queryByText(en.Home.leadEmpty)).toBeNull();
});

it("opens on the default currency and lists its tab first", () => {
  const defs = [{ code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true }, { code: "LBP", symbol: "LBP", decimalPlaces: 0, disabled: false, firstUsed: true }];
  const balances = [
    { id: "b1", walletId: "wallet", currency: "USD", openingBalanceMinor: 0, balanceMinor: 100, position: 0, detached: false },
    { id: "b2", walletId: "wallet", currency: "LBP", openingBalanceMinor: 0, balanceMinor: 5000, position: 1, detached: false },
  ];
  render(<NextIntlClientProvider locale="en" messages={en}><AppDataProvider currencies={defs} defaultCurrency="LBP" walletContainers={[{ id: "wallet", name: "Main", kind: "cash", position: 0, deleted: false, needsAttention: false, defaultBalanceId: "b1", balances }]} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}><HomeView recent={null} commitments={<HomeCommitments salaryStatus={{ receiptId: null, lastReceivedOn: null, receivedThisMonth: false }} fixed={[]} installments={[]} cycleUnavailable={true} />} budgetSummary={null} /></AppDataProvider></NextIntlClientProvider>);
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual(["LBP", "USD"]);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
});
