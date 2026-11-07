// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { AppDataProvider } from "@/components/providers/app-data";
import type { CurrencyDefinition } from "@/lib/currency";
import type { WalletContainer } from "@/features/wallets/schema";
import { WalletsView } from "./wallets-view";
const openWallet = vi.fn();
const reorderWallets = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/features/wallets/actions", () => ({ reorderWallets: (...args: unknown[]) => reorderWallets(...args) }));
vi.mock("@/components/shell/composer", () => ({ useComposer: () => ({ openWallet }) }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("@/components/shell/screen-header", () => ({ ScreenHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const currencies: CurrencyDefinition[] = [
  { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true },
  { code: "TOKEN", symbol: "◈", decimalPlaces: 8, disabled: false, firstUsed: false },
  { code: "JPY", symbol: "¥", decimalPlaces: 0, disabled: true, firstUsed: true },
];
const wallets: WalletContainer[] = ["Pocket", "Bank", "Review", "Deleted"].map((name, index) => ({
  id: name, name, kind: "cash", position: index, deleted: name === "Deleted", needsAttention: name === "Review",
  defaultBalanceId: `${name}-${index === 1 ? "TOKEN" : "USD"}`,
  balances: currencies.map((currency, position) => ({ id: `${name}-${currency.code}`, walletId: name, currency: currency.code, position, detached: false, openingBalanceMinor: 0, balanceMinor: currency.code === "TOKEN" ? 123456789 + index : 250 + index })),
}));
function view(locale = "en", catalog = currencies, containers = wallets) {
  return <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en}><AppDataProvider walletContainers={containers} currencies={catalog} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}><WalletsView /></AppDataProvider></NextIntlClientProvider>;
}
it.each(["en", "ar"])("%s: one global selector retains all ordinary wallets with exact selected balances and defaults", (locale) => {
  render(view(locale));
  const tabs = screen.getAllByRole("tab");
  expect(screen.getAllByRole("tablist")).toHaveLength(1);
  expect(tabs.map((node) => node.textContent)).toEqual(["USD", "TOKEN"]);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  const ordinary = screen.getByRole("list", { name: locale === "en" ? "Wallets" : ar.Nav.wallets });
  expect(within(ordinary).getAllByRole("listitem")).toHaveLength(2);
  expect(ordinary.textContent).toContain("$2.50");
  fireEvent.click(tabs[1]);
  expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  expect(within(ordinary).getAllByRole("listitem")).toHaveLength(2);
  expect(ordinary.textContent).toContain("◈1.23456789");
  expect(ordinary.textContent).toContain("◈1.23456790");
  expect(ordinary.textContent).not.toContain("$2.50");
  expect(ordinary.textContent).toContain("USD");
  expect(screen.queryByText(en.Wallets.total)).toBeNull();
  expect(screen.queryByText("Deleted")).toBeNull();
  fireEvent.click(within(ordinary).getByRole("button", { name: (locale === "en" ? en : ar).Wallets.editNamed.replace("{name}", "Pocket") }));
  expect(openWallet).toHaveBeenCalledWith(expect.objectContaining({ id: "Pocket", defaultBalanceId: "Pocket-USD" }));
  expect(ordinary.querySelector('.amount')?.getAttribute("dir")).toBe("ltr");
});
it("retains the same saved global order across currency selection and exact defaults", async () => {
  render(view());
  const handle = screen.getByRole("button", { name: "Reorder Pocket" });
  fireEvent.keyDown(handle, { key: " " });
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  fireEvent.keyDown(handle, { key: " " });
  await waitFor(() => expect(reorderWallets).toHaveBeenCalledWith(["Bank", "Pocket"]));
  fireEvent.click(screen.getByRole("tab", { name: "TOKEN" }));
  const ordinary = screen.getByRole("list", { name: "Wallets" });
  expect(within(ordinary).getAllByRole("listitem").map((item) => item.querySelector("bdi")?.textContent)).toEqual(["Bank", "Pocket"]);
  expect(ordinary.textContent).toContain("◈1.23456790");
  fireEvent.click(within(ordinary).getByRole("button", { name: "Edit Bank" }));
  expect(openWallet).toHaveBeenCalledWith(expect.objectContaining({ id: "Bank", defaultBalanceId: "Bank-TOKEN" }));
});
it("keeps Needs-attention wallets in a separate labeled section", () => {
  render(view());
  const attention = screen.getByRole("region", { name: "Needs attention" });
  expect(attention.textContent).toContain("Review");
  expect(screen.getByRole("list", { name: "Wallets" }).textContent).not.toContain("Review");
});
it("falls back to the first enabled catalog currency after a refreshed selection becomes disabled", () => {
  const rendered = render(view());
  fireEvent.click(screen.getByRole("tab", { name: "TOKEN" }));
  const catalog = currencies.map((currency) => currency.code === "TOKEN" ? { ...currency, disabled: true } : currency);
  rendered.rerender(view("en", catalog, wallets.map((wallet) => ({ ...wallet, defaultBalanceId: `${wallet.id}-USD` }))));
  expect(screen.queryByRole("tab", { name: "TOKEN" })).toBeNull();
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(screen.getByRole("list", { name: "Wallets" }).textContent).toContain("$2.50");
});
