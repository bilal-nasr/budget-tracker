import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
import { AppDataProvider } from "@/components/providers/app-data";
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render as renderBase, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { CashSettlementSummary } from "./cash-settlement-summary";

afterEach(cleanup);

const usdWallet = "00000000-0000-4000-8000-000000000001";
const lbpWallet = "00000000-0000-4000-8000-000000000003";
const renderSummary = (changes: Array<{ balanceId: string; amountMinor: number; currency: "USD" | "LBP"; walletNameSnapshot?: string }>) => render(
  <NextIntlClientProvider locale="en" messages={en}>
    <CashSettlementSummary settlement={{ tenderMinor: 2000, tenderCurrency: "USD", changes }} costMinor={1250} currency="USD"
      changeWalletNames={changes.map((change) => change.balanceId === usdWallet ? "Cash" : "Lebanese cash")} />
  </NextIntlClientProvider>,
);

describe("cash settlement summary", () => {
  it("shows purchase cost, tender, and every returned amount with its destination", () => {
    renderSummary([
      { balanceId: usdWallet, amountMinor: 500, currency: "USD" },
      { balanceId: lbpWallet, amountMinor: 223750, currency: "LBP" },
    ]);
    expect(screen.getByText("$12.50", { exact: true })).toBeTruthy();
    expect(screen.getByText("$20.00", { exact: true })).toBeTruthy();
    expect(screen.getByText("$5.00", { exact: true })).toBeTruthy();
    expect(screen.getByText("LBP 223,750", { exact: true })).toBeTruthy();
    expect(screen.getByText("Cash", { exact: true })).toBeTruthy();
    expect(screen.getByText("Lebanese cash", { exact: true })).toBeTruthy();
  });

  it("uses the original receiver snapshot after the current name changes", () => {
    renderSummary([{balanceId: usdWallet,amountMinor:500,currency:"USD",walletNameSnapshot:"Original receiver"}]);
    expect(screen.getByText("Original receiver")).toBeTruthy();expect(screen.queryByText("Cash",{exact:true})).toBeNull();
  });
  it("shows the localized no-change fallback when tender exactly matches cost", () => {
    renderSummary([]);
    expect(screen.getByText(en.Cashier.noChange, { exact: true })).toBeTruthy();
  });

  it("keeps LBP cost, USD tender, and LBP returned cash independent", () => {
    render(<NextIntlClientProvider locale="en" messages={en}>
      <CashSettlementSummary settlement={{ tenderMinor: 500, tenderCurrency: "USD", changes: [
        { balanceId: lbpWallet, amountMinor: 110000, currency: "LBP" },
      ] }} costMinor={340000} currency="LBP" changeWalletNames={["Lebanese cash"]} />
    </NextIntlClientProvider>);
    expect(screen.getByText("LBP 340,000", { exact: true })).toBeTruthy();
    expect(screen.getByText("$5.00", { exact: true })).toBeTruthy();
    expect(screen.getByText("LBP 110,000", { exact: true })).toBeTruthy();
  });
});

it("lists every payment with its own currency and wallet, never a combined total", () => {
  render(<NextIntlClientProvider locale="en" messages={en}>
    <CashSettlementSummary settlement={{ tenderMinor: 300, tenderCurrency: "USD",
      extraTenders: [{ balanceId: lbpWallet, amountMinor: 1300000, currency: "LBP", walletNameSnapshot: "Lira at payment" }],
      changes: [{ balanceId: usdWallet, amountMinor: 500, currency: "USD" }, { balanceId: lbpWallet, amountMinor: 10000, currency: "LBP" }] }}
      costMinor={1000} currency="USD" tenderWalletNames={["Cash", undefined]} changeWalletNames={["Cash", "Lebanese cash"]} />
  </NextIntlClientProvider>);
  for (const amount of ["$10.00", "$3.00", "LBP 1,300,000", "$5.00", "LBP 10,000"]) expect(screen.getByText(amount, { exact: true })).toBeTruthy();
  expect(screen.getAllByText(en.Cashier.tender, { exact: true })).toHaveLength(2);
  expect(screen.getAllByText(en.Cashier.tenderFrom, { exact: true })).toHaveLength(2);
  expect(screen.getByText("Lira at payment", { exact: true })).toBeTruthy();
  expect(screen.queryByText(en.Cashier.rate, { exact: true })).toBeNull();
});

function render(node: React.ReactNode) { return renderBase(<AppDataProvider walletContainers={[]} currencies={[...SEED_CURRENCY_DEFINITIONS]} categories={[]} timezone="Asia/Beirut" salary={null} usdLbpRate={null}>{node}</AppDataProvider>); }
