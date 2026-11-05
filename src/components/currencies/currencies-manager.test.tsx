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
  SheetShell: ({ open, title, children, footer }: { open: boolean; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) => open ? <section aria-label={String(title)}>{children}{footer}</section> : null,
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
  render(<NextIntlClientProvider locale="en" messages={en}><CurrenciesManager currencies={currencies} /></NextIntlClientProvider>);
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
  renderManager([eur, usd]);
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.disableNamed.replace("{code}", "EUR") }));
  await screen.findByText(en.CurrencySettings.disableReady);
  fireEvent.click(await screen.findByRole("button", { name: en.CurrencySettings.confirmDisable }));
  await waitFor(() => expect(actions.enabled).toHaveBeenCalledWith("EUR", false));
  expect(screen.getByTestId("currency-status-EUR").textContent).toContain(en.CurrencySettings.disabled);
});

it("re-enables directly without changing defaults or running disable inspection", async () => {
  renderManager([eur, jpy]);
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.enableNamed.replace("{code}", "JPY") }));
  await waitFor(() => expect(actions.enabled).toHaveBeenCalledWith("JPY", true));
  expect(actions.inspect).not.toHaveBeenCalled();
  expect(screen.getByTestId("currency-status-JPY").textContent).toContain(en.CurrencySettings.enabled);
});

it("fails closed and keeps the disable sheet open when inspection is unavailable", async () => {
  actions.inspect.mockRejectedValue(new Error("transport detail"));
  renderManager([eur, usd]);
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.disableNamed.replace("{code}", "EUR") }));
  expect((await screen.findByRole("alert")).textContent).toContain(en.CurrencySettings.errorFailed);
  expect(screen.getByRole("region", { name: en.CurrencySettings.disableTitle.replace("{code}", "EUR") })).toBeTruthy();
  expect(actions.enabled).not.toHaveBeenCalled();
});

it("isolates currency codes and amount previews in Arabic", () => {
  render(<NextIntlClientProvider locale="ar" messages={ar}><CurrenciesManager currencies={[eur, usd]} /></NextIntlClientProvider>);
  expect(screen.getAllByTestId("currency-code")[0].getAttribute("dir")).toBe("ltr");
  expect(screen.getAllByText(/€/)[0].closest("bdi")?.getAttribute("dir")).toBe("ltr");
});
