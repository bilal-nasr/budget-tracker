// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import type { CurrencyDefinition } from "@/lib/currency";

const actions = vi.hoisted(() => ({ inspect: vi.fn(), enabled: vi.fn() }));
vi.mock("@/features/currencies/actions", () => ({
  inspectCurrencyDisable: actions.inspect,
  setCurrencyEnabled: actions.enabled,
}));
vi.mock("./currency-sheet", () => ({ CurrencySheet: () => null }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/ui/sheet-shell", () => ({
  SheetShell: ({ open, title, children, footer }: { open: boolean; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) => open ? <section><h2>{title}</h2>{children}{footer}</section> : null,
}));
import { CurrenciesManager } from "./currencies-manager";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  actions.inspect.mockResolvedValue([]);
  actions.enabled.mockResolvedValue({ ok: true });
});

const eur: CurrencyDefinition = { code: "EUR", symbol: "€", decimalPlaces: 2, disabled: false, firstUsed: true };
const usd: CurrencyDefinition = { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true };
const jpy: CurrencyDefinition = { code: "JPY", symbol: "¥", decimalPlaces: 0, disabled: true, firstUsed: false };

function renderManager(currencies: CurrencyDefinition[]) {
  return render(<NextIntlClientProvider locale="en" messages={en}><CurrenciesManager currencies={currencies} /></NextIntlClientProvider>);
}

it("orders enabled definitions before disabled ones without changing catalog order inside each group", () => {
  renderManager([jpy, eur, { ...usd, disabled: true }, { ...jpy, code: "GBP", disabled: false }]);
  expect(screen.getAllByTestId("currency-row").map((row) => within(row).getByTestId("currency-code").textContent)).toEqual(["EUR", "GBP", "JPY", "USD"]);
});

it("protects the last enabled currency before attempting inspection", () => {
  renderManager([eur, jpy]);
  expect((screen.getByRole("button", { name: en.CurrencySettings.disableNamed.replace("{code}", "EUR") }) as HTMLButtonElement).disabled).toBe(true);
  expect(actions.inspect).not.toHaveBeenCalled();
});

it("shows actionable wallet blockers and does not attempt the disable write", async () => {
  actions.inspect.mockResolvedValue([
    { kind: "nonzeroBalance", balanceId: "balance", walletId: "wallet", walletName: "Pocket" },
    { kind: "lastWalletBalance", walletId: "wallet", walletName: "Pocket" },
  ]);
  renderManager([eur, usd]);
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.disableNamed.replace("{code}", "EUR") }));
  expect((await screen.findAllByText("Pocket")).length).toBe(2);
  expect(screen.getAllByRole("link", { name: "Pocket" })[0].getAttribute("href")).toBe("/wallets");
  expect(actions.enabled).not.toHaveBeenCalled();
});

it("confirms a safe disable and keeps the definition available as disabled history", async () => {
  const rendered = renderManager([eur, usd]);
  actions.enabled.mockImplementation(async () => {
    rendered.rerender(<NextIntlClientProvider locale="en" messages={en}><CurrenciesManager currencies={[{ ...eur, disabled: true }, usd]} /></NextIntlClientProvider>);
    return { ok: true };
  });
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.disableNamed.replace("{code}", "EUR") }));
  await screen.findByText(en.CurrencySettings.disableReady);
  fireEvent.click(await screen.findByRole("button", { name: en.CurrencySettings.confirmDisable }));
  await waitFor(() => expect(actions.enabled).toHaveBeenCalledWith("EUR", false));
  await waitFor(() => expect(screen.getByTestId("currency-status-EUR").textContent).toContain(en.CurrencySettings.disabled));
});

it("re-enables directly without changing defaults or running disable inspection", async () => {
  const rendered = renderManager([eur, jpy]);
  actions.enabled.mockImplementation(async () => {
    rendered.rerender(<NextIntlClientProvider locale="en" messages={en}><CurrenciesManager currencies={[eur, { ...jpy, disabled: false }]} /></NextIntlClientProvider>);
    return { ok: true };
  });
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.enableNamed.replace("{code}", "JPY") }));
  await waitFor(() => expect(actions.enabled).toHaveBeenCalledWith("JPY", true));
  expect(actions.inspect).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByTestId("currency-status-JPY").textContent).toContain(en.CurrencySettings.enabled));
});

it("fails closed and keeps the disable sheet open when inspection is unavailable", async () => {
  actions.inspect.mockRejectedValue(new Error("transport detail"));
  renderManager([eur, usd]);
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.disableNamed.replace("{code}", "EUR") }));
  expect((await screen.findByRole("alert")).textContent).toContain(en.CurrencySettings.errorFailed);
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Disable EUR?");
  expect(actions.enabled).not.toHaveBeenCalled();
});

it("isolates currency codes and amount previews in Arabic", () => {
  render(<NextIntlClientProvider locale="ar" messages={ar}><CurrenciesManager currencies={[eur, usd]} /></NextIntlClientProvider>);
  expect(screen.getAllByTestId("currency-code")[0].getAttribute("dir")).toBe("ltr");
  expect(screen.getAllByText(/€/)[0].closest("bdi")?.getAttribute("dir")).toBe("ltr");
});

it("does not invent enabled state while waiting for authoritative server props", async () => {
  renderManager([eur, jpy]);
  fireEvent.click(screen.getByRole("button", { name: "Enable JPY" }));
  await waitFor(() => expect(actions.enabled).toHaveBeenCalledWith("JPY", true));
  expect(screen.getByTestId("currency-status-JPY").textContent).toBe(en.CurrencySettings.disabled);
});

it("shows blockers across wallets and future-writing features without a confirmation action", async () => {
  actions.inspect.mockResolvedValue([
    { kind: "nonzeroBalance", balanceId: "pocket-eur", walletId: "pocket", walletName: "Pocket" },
    { kind: "salary", balanceId: "bank-eur", walletId: "bank", walletName: "Bank" },
    { kind: "fixedExpense", id: "rent", name: "Rent", balanceId: "bank-eur" },
    { kind: "installment", id: "phone", name: "Phone", balanceId: "pocket-eur" },
    { kind: "loan", id: "loan", name: "Loan", balanceId: "bank-eur" },
    { kind: "pendingPayment", id: "pending", label: "Client invoice" },
    { kind: "budget", id: "budget", categoryId: "food", startsMonth: "2026-12-01" },
  ]);
  renderManager([eur, usd]);
  fireEvent.click(screen.getByRole("button", { name: "Disable EUR" }));
  expect(await screen.findByRole("link", { name: "Pocket" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Bank" })).toBeTruthy();
  expect(screen.getByText(/Rent/)).toBeTruthy();
  expect(screen.getByText(/Phone/)).toBeTruthy();
  expect(screen.getByText(/2026-12/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: en.CurrencySettings.confirmDisable })).toBeNull();
});

it("keeps a rejected disable open without changing visible enabled state", async () => {
  actions.enabled.mockResolvedValue({ ok: false, error: "currencyInUse" });
  renderManager([eur, usd]);
  fireEvent.click(screen.getByRole("button", { name: "Disable EUR" }));
  fireEvent.click(await screen.findByRole("button", { name: en.CurrencySettings.confirmDisable }));
  expect((await screen.findByRole("alert")).textContent).toBe(en.CurrencySettings.errorBlocked);
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Disable EUR?");
  expect(screen.getByTestId("currency-status-EUR").textContent).toBe(en.CurrencySettings.enabled);
});
