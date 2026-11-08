// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { AppDataProvider } from "@/components/providers/app-data";
import type { CurrencyDefinition } from "@/lib/currency";
import type { ShoppingItem } from "@/features/items/schema";
import { ItemsView } from "./items-view";

vi.mock("@/features/items/actions", () => ({ createItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(), buyItems: vi.fn() }));
vi.mock("@/features/transactions/actions", () => ({ deleteTransaction: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/shell/screen-header", () => ({ ScreenHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }));
afterEach(cleanup);

const currencies: CurrencyDefinition[] = [
  { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true },
  { code: "LBP", symbol: "LBP", decimalPlaces: 0, disabled: false, firstUsed: true },
];
const item = (id: string, name: string, priceMinor: number, currency = "USD", boughtOn: string | null = null): ShoppingItem =>
  ({ id: `ac000000-0000-4000-8000-00000000000${id}`, name, currency, priceMinor, createdAt: `2026-11-0${id}T00:00:00Z`, boughtOn, transactionId: boughtOn ? "t" : null });
const items = [item("1", "Milk", 350), item("2", "Bread", 150), item("3", "Charger", 1800), item("4", "Fuel", 90000, "LBP"), item("5", "Eggs", 400, "USD", "2026-11-02")];

function view(locale = "en") {
  return <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en}>
    <AppDataProvider walletContainers={[]} currencies={currencies} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}><ItemsView items={items} /></AppDataProvider>
  </NextIntlClientProvider>;
}

it.each(["en", "ar"])("%s: totals the open items and only the ticked ones, per currency", (locale) => {
  const messages = locale === "ar" ? ar.Items : en.Items;
  render(view(locale));
  const header = screen.getByRole("banner");
  // Bought items are not part of what is left to buy; other currencies are never added in.
  expect(header.textContent).toContain("$23.00");
  expect(header.textContent).toContain(messages.count.replace("{count}", "3"));
  expect(header.textContent).toContain(messages.selectedLabel.replace("{count}", "0"));
  fireEvent.click(screen.getByRole("checkbox", { name: messages.selectRow.replace("{name}", "Milk") }));
  fireEvent.click(screen.getByRole("checkbox", { name: messages.selectRow.replace("{name}", "Charger") }));
  expect(header.textContent).toContain(messages.selectedLabel.replace("{count}", "2"));
  expect(header.textContent).toContain("$21.50");
  // Switching currency starts a fresh selection with that currency's own total.
  fireEvent.click(screen.getByRole("tab", { name: "LBP" }));
  expect(header.textContent).toContain("LBP 90,000");
  expect(header.textContent).toContain(messages.selectedLabel.replace("{count}", "0"));
  expect(screen.queryByText("Milk")).toBeNull();
});

it("select all and clear, and the bought list stays apart", () => {
  render(view());
  fireEvent.click(screen.getByRole("button", { name: en.Items.selectAll }));
  expect(screen.getAllByRole("checkbox").every((box) => (box as HTMLInputElement).checked)).toBe(true);
  expect(screen.getByRole("banner").textContent).toContain("$23.00");
  fireEvent.click(screen.getAllByRole("button", { name: en.Items.clearSelection })[0]);
  expect(screen.getAllByRole("checkbox").some((box) => (box as HTMLInputElement).checked)).toBe(false);
  const bought = screen.getByText(en.Items.completed.replace("{count}", "1")).closest("details")!;
  expect(within(bought).getByText("Eggs")).toBeTruthy();
});
