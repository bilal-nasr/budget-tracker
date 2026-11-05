// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import type { CurrencyDefinition } from "@/lib/currency";
import type { WalletContainer } from "@/features/wallets/schema";
import { AppDataProvider, useAppData } from "@/components/providers/app-data";

const actions = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn(), inspect: vi.fn(), enabled: vi.fn() }));
vi.mock("@/features/profile/actions", () => ({ setDefaultCurrency: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/features/currencies/actions", () => ({
  createCurrency: actions.create,
  updateCurrency: actions.update,
  deleteCurrency: actions.remove,
  inspectCurrencyDisable: actions.inspect,
  setCurrencyEnabled: actions.enabled,
}));
vi.mock("@/i18n/navigation", () => ({ Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/ui/sheet-shell", () => ({
  SheetShell: ({ open, title, description, children, footer }: { open: boolean; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) => open ? <section><h2>{title}</h2>{description ? <p>{description}</p> : null}{children}{footer}</section> : null,
}));
import { CurrenciesManager } from "./currencies-manager";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  actions.create.mockResolvedValue({ ok: true });
  actions.update.mockResolvedValue({ ok: true });
  actions.remove.mockResolvedValue({ ok: true });
  actions.inspect.mockResolvedValue([]);
  actions.enabled.mockResolvedValue({ ok: true });
});

const usd: CurrencyDefinition = { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true };
const eur: CurrencyDefinition = { code: "EUR", symbol: "€", decimalPlaces: 2, disabled: false, firstUsed: false };
const jpy: CurrencyDefinition = { code: "JPY", symbol: "¥", decimalPlaces: 0, disabled: true, firstUsed: false };

function view(currencies: CurrencyDefinition[], locale: "en" | "ar" = "en") {
  const messages = locale === "ar" ? ar : en;
  return <NextIntlClientProvider locale={locale} messages={messages}><CurrenciesManager currencies={currencies} /></NextIntlClientProvider>;
}

it("shows a successfully created currency from refreshed props without duplicate rows", async () => {
  const rendered = render(view([usd]));
  actions.create.mockImplementation(async () => {
    rendered.rerender(view([usd, eur]));
    return { ok: true };
  });
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.add }));
  fireEvent.change(screen.getByLabelText(en.CurrencySettings.code), { target: { value: " eur " } });
  fireEvent.change(screen.getByLabelText(en.CurrencySettings.symbol), { target: { value: "€" } });
  fireEvent.change(screen.getByLabelText(en.CurrencySettings.decimalPlaces), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.save }));
  await waitFor(() => expect(actions.create).toHaveBeenCalled());
  await waitFor(() => expect(screen.getAllByTestId("currency-code").map((node) => node.textContent)).toEqual(["USD", "EUR"]));
  rendered.rerender(view([usd, eur]));
  await waitFor(() => expect(screen.getAllByTestId("currency-code").filter((node) => node.textContent === "EUR")).toHaveLength(1));
});

it("updates a successfully edited symbol from refreshed props", async () => {
  const rendered = render(view([usd, eur]));
  actions.update.mockImplementation(async () => {
    rendered.rerender(view([{ ...usd, symbol: "US$" }, eur]));
    return { ok: true };
  });
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.editNamed.replace("{code}", "USD") }));
  fireEvent.change(screen.getByLabelText(en.CurrencySettings.symbol), { target: { value: "US$" } });
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.save }));
  await waitFor(() => expect(actions.update).toHaveBeenCalledWith("USD", { code: "USD", symbol: "US$", decimalPlaces: 2 }));
  await waitFor(() => {
    const row = screen.getAllByTestId("currency-row").find((candidate) => within(candidate).getByTestId("currency-code").textContent === "USD");
    expect(row?.textContent).toContain("US$ 1,234.56");
  });
});

it("removes a successfully deleted unused definition from refreshed props", async () => {
  const rendered = render(view([usd, jpy]));
  actions.remove.mockImplementation(async () => {
    rendered.rerender(view([usd]));
    return { ok: true };
  });
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.editNamed.replace("{code}", "JPY") }));
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.delete }));
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.confirmDelete }));
  await waitFor(() => expect(actions.remove).toHaveBeenCalledWith("JPY"));
  await waitFor(() => expect(screen.queryByText("JPY")).toBeNull());
});

it("isolates currency codes inside Arabic edit, delete, and disable titles", async () => {
  render(view([usd, eur], "ar"));
  fireEvent.click(screen.getByRole("button", { name: ar.CurrencySettings.editNamed.replace("{code}", "EUR") }));
  let heading = screen.getByRole("heading", { level: 2 });
  expect(within(heading).getByText("EUR").closest("bdi")?.getAttribute("dir")).toBe("ltr");
  fireEvent.click(screen.getByRole("button", { name: ar.CurrencySettings.delete }));
  heading = screen.getByRole("heading", { level: 2 });
  expect(within(heading).getByText("EUR").closest("bdi")?.getAttribute("dir")).toBe("ltr");
  cleanup();

  render(view([usd, eur], "ar"));
  fireEvent.click(screen.getByRole("button", { name: ar.CurrencySettings.disableNamed.replace("{code}", "EUR") }));
  heading = await screen.findByRole("heading", { level: 2 });
  expect(within(heading).getByText("EUR").closest("bdi")?.getAttribute("dir")).toBe("ltr");
});

it("keeps a newer server edit authoritative when an older save resolves afterward", async () => {
  let finish!: (result: { ok: true }) => void;
  actions.update.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const rendered = render(view([usd, eur]));
  fireEvent.click(screen.getByRole("button", { name: "Edit USD" }));
  fireEvent.change(screen.getByLabelText(en.CurrencySettings.symbol), { target: { value: "US$" } });
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.save }));
  rendered.rerender(view([{ ...usd, symbol: "🪙" }, eur]));
  await act(async () => finish({ ok: true }));
  const row = screen.getAllByTestId("currency-row")[0];
  expect(row.textContent).toContain("🪙1,234.56");
  expect(row.textContent).not.toContain("US$");
});

it.each(["en", "ar"] as const)("explains global add and enable coverage in %s", (locale) => {
  render(view([usd, jpy], locale));
  const copy = locale === "en" ? /every wallet/ : /كل محفظة/;
  expect(screen.getByText(copy).textContent).toMatch(locale === "en" ? /enabl/ : /تفعيل/);
  fireEvent.click(screen.getByRole("button", { name: (locale === "en" ? en : ar).CurrencySettings.add }));
  expect(screen.getAllByText(copy).length).toBeGreaterThan(1);
});

function CoverageProbe() {
  const data = useAppData();
  return <output data-testid="coverage">{JSON.stringify({
    ordinary: data.walletContainers.map((wallet) => [wallet.id, wallet.balances.map((balance) => balance.id)]),
    canonical: ["pocket", "bank", "attention", "deleted"].map((id) => {
      const wallet = data.walletById(id)!;
      return [id, wallet.defaultBalanceId, wallet.balances.map((balance) => balance.id)];
    }),
  })}</output>;
}

it.each(["add", "enable"] as const)("refreshes %s coverage across all live wallets using server identities and preserved defaults", async (operation) => {
  const makeWallet = (id: string): WalletContainer => ({
    id, name: id, kind: "cash", position: 0, deleted: id === "deleted", needsAttention: id === "attention",
    defaultBalanceId: `${id}-usd`,
    balances: [{ id: `${id}-usd`, walletId: id, currency: "USD", openingBalanceMinor: 0, balanceMinor: 0, position: 0, detached: false }],
  });
  const beforeWallets = ["pocket", "bank", "attention", "deleted"].map(makeWallet);
  if (operation === "enable") for (const wallet of beforeWallets) wallet.balances.push({
    id: `${wallet.id}-jpy`, walletId: wallet.id, currency: "JPY", openingBalanceMinor: 0, balanceMinor: 0, position: 1, detached: false,
  });
  const beforeCatalog = operation === "add" ? [usd] : [usd, jpy];
  const globalView = (catalog: CurrencyDefinition[], wallets: WalletContainer[]) => <NextIntlClientProvider locale="en" messages={en}>
    <AppDataProvider walletContainers={wallets} currencies={catalog} categories={[]} timezone="Asia/Beirut" salary={null} usdLbpRate={null}>
      <CurrenciesManager currencies={catalog} /><CoverageProbe />
    </AppDataProvider>
  </NextIntlClientProvider>;
  const rendered = render(globalView(beforeCatalog, beforeWallets));
  expect(JSON.parse(screen.getByTestId("coverage").textContent!).ordinary).toEqual([
    ["pocket", ["pocket-usd"]], ["bank", ["bank-usd"]],
  ]);
  let finish!: (result: { ok: true }) => void;
  const action = operation === "add" ? actions.create : actions.enabled;
  action.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  if (operation === "add") {
    fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.add }));
    fireEvent.change(screen.getByLabelText(en.CurrencySettings.code), { target: { value: "JPY" } });
    fireEvent.change(screen.getByLabelText(en.CurrencySettings.symbol), { target: { value: "¥" } });
    fireEvent.change(screen.getByLabelText(en.CurrencySettings.decimalPlaces), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.save }));
    expect(action).toHaveBeenCalledWith({ code: "JPY", symbol: "¥", decimalPlaces: 0 });
  } else {
    fireEvent.click(screen.getByRole("button", { name: "Enable JPY" }));
    expect(action).toHaveBeenCalledWith("JPY", true);
  }
  expect(JSON.parse(screen.getByTestId("coverage").textContent!).ordinary).toEqual([
    ["pocket", ["pocket-usd"]], ["bank", ["bank-usd"]],
  ]);
  const refreshedWallets = beforeWallets.map((wallet) => wallet.deleted || operation === "enable" ? wallet : {
    ...wallet, balances: [...wallet.balances, { id: `${wallet.id}-jpy`, walletId: wallet.id, currency: "JPY", openingBalanceMinor: 0, balanceMinor: 0, position: 1, detached: false }],
  });
  await act(async () => {
    rendered.rerender(globalView([usd, { ...jpy, disabled: false }], refreshedWallets));
    finish({ ok: true });
  });
  const snapshot = JSON.parse(screen.getByTestId("coverage").textContent!);
  expect(snapshot.ordinary).toEqual([
    ["pocket", ["pocket-usd", "pocket-jpy"]], ["bank", ["bank-usd", "bank-jpy"]],
  ]);
  expect(snapshot.canonical).toEqual([
    ["pocket", "pocket-usd", ["pocket-usd", "pocket-jpy"]],
    ["bank", "bank-usd", ["bank-usd", "bank-jpy"]],
    ["attention", "attention-usd", ["attention-usd", "attention-jpy"]],
    ["deleted", "deleted-usd", operation === "add" ? ["deleted-usd"] : ["deleted-usd", "deleted-jpy"]],
  ]);
  expect(screen.getAllByTestId("currency-code").map((node) => node.textContent)).toEqual(["USD", "JPY"]);
});
