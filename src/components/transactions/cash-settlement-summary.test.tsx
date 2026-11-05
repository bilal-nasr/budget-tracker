// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { CashSettlementSummary } from "./cash-settlement-summary";

afterEach(cleanup);

const usdWallet = "00000000-0000-4000-8000-000000000001";
const lbpWallet = "00000000-0000-4000-8000-000000000003";
const renderSummary = (changes: Array<{ walletId: string; amountMinor: number; currency: "USD" | "LBP" }>) => render(
  <NextIntlClientProvider locale="en" messages={en}>
    <CashSettlementSummary settlement={{ tenderMinor: 2000, changes }} costMinor={1250} currency="USD"
      changeWalletNames={changes.map((change) => change.walletId === usdWallet ? "Cash" : "Lebanese cash")} />
  </NextIntlClientProvider>,
);

describe("cash settlement summary", () => {
  it("shows purchase cost, tender, and every returned amount with its destination", () => {
    renderSummary([
      { walletId: usdWallet, amountMinor: 500, currency: "USD" },
      { walletId: lbpWallet, amountMinor: 223750, currency: "LBP" },
    ]);
    expect(screen.getByText("$12.50", { exact: true })).toBeTruthy();
    expect(screen.getByText("$20.00", { exact: true })).toBeTruthy();
    expect(screen.getByText("$5.00", { exact: true })).toBeTruthy();
    expect(screen.getByText("LBP 223,750", { exact: true })).toBeTruthy();
    expect(screen.getByText("Cash", { exact: true })).toBeTruthy();
    expect(screen.getByText("Lebanese cash", { exact: true })).toBeTruthy();
  });

  it("shows the localized no-change fallback when tender exactly matches cost", () => {
    renderSummary([]);
    expect(screen.getByText(en.Cashier.noChange, { exact: true })).toBeTruthy();
  });
});
