// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { AppDataProvider } from "@/components/providers/app-data";
import { HomeView } from "./home-view";
vi.mock("@/components/shell/composer", () => ({ useComposer: () => ({ openWallet: vi.fn() }) }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("@/components/shell/screen-header", () => ({ ScreenHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }));
vi.mock("server-only", () => ({}));
afterEach(cleanup);
it("shows a custom-default wallet's exact balance without a legacy fallback or combined total", () => {
 render(<NextIntlClientProvider locale="en" messages={en}><AppDataProvider currencies={[{ code: "TOKEN", symbol: "◈", decimalPlaces: 8, disabled: false, firstUsed: true }]} walletContainers={[{ id: "wallet", name: "Custom", kind: "cash", position: 0, deleted: false, needsAttention: false, defaultBalanceId: "balance", balances: [{ id: "balance", walletId: "wallet", currency: "TOKEN", openingBalanceMinor: 0, balanceMinor: 123456789, position: 0, detached: false }] }]} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}><HomeView recent={null} commitments={null} budgetSummary={null} /></AppDataProvider></NextIntlClientProvider>);
 expect(screen.getByText("◈1.23456789").textContent).toBe("◈1.23456789");
 expect(screen.getByText("Custom")).toBeTruthy();
 expect(screen.queryByText(en.Home.leadEmpty)).toBeNull();
});
