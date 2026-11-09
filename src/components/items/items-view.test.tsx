// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { AppDataProvider } from "@/components/providers/app-data";
import type { CurrencyDefinition } from "@/lib/currency";
import type { ShoppingItem } from "@/features/items/schema";
import { ItemsView } from "./items-view";

const mocks = vi.hoisted(() => ({ move: vi.fn(), createFolder: vi.fn(), push: vi.fn() }));
vi.mock("@/features/items/actions", () => ({ createItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(), buyItems: vi.fn(), moveItemsToFolder: mocks.move }));
vi.mock("@/features/invoices/actions", () => ({ createFolder: mocks.createFolder }));
vi.mock("@/features/transactions/actions", () => ({ deleteTransaction: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>, useRouter: () => ({ refresh: vi.fn(), push: mocks.push }) }));
vi.mock("@/components/shell/screen-header", () => ({ ScreenHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const currencies: CurrencyDefinition[] = [
  { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true },
  { code: "LBP", symbol: "LBP", decimalPlaces: 0, disabled: false, firstUsed: true },
];
const item = (id: string, name: string, priceMinor: number, currency = "USD", boughtOn: string | null = null): ShoppingItem =>
  ({ id: `ac000000-0000-4000-8000-00000000000${id}`, name, currency, priceMinor, createdAt: `2026-11-0${id}T00:00:00Z`, boughtOn, transactionId: boughtOn ? "t" : null });
const items = [item("1", "Milk", 350), item("2", "Bread", 150), item("3", "Charger", 1800), item("4", "Fuel", 90000, "LBP"), item("5", "Eggs", 400, "USD", "2026-11-02")];

const folders = [{ id: "1f000000-0000-4000-8000-000000000001", name: "PC build" }, { id: "1f000000-0000-4000-8000-000000000002", name: "Living room" }];

function view(locale = "en", choices = folders) {
  return <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en}>
    <AppDataProvider walletContainers={[]} currencies={currencies} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}><ItemsView items={items} folders={choices} /></AppDataProvider>
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

it("moves the ticked items into an existing folder", async () => {
  mocks.move.mockResolvedValue({ ok: true, moved: 2 });
  render(view());
  fireEvent.click(screen.getByRole("checkbox", { name: en.Items.selectRow.replace("{name}", "Milk") }));
  fireEvent.click(screen.getByRole("checkbox", { name: en.Items.selectRow.replace("{name}", "Bread") }));
  fireEvent.click(screen.getByRole("button", { name: en.Items.moveToFolder }));
  const sheet = await screen.findByRole("dialog");
  // The first folder is chosen already, and the last option offers a new one.
  expect((within(sheet).getByRole("radio", { name: "PC build" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(sheet).getByRole("radio", { name: "Living room" }));
  fireEvent.click(within(sheet).getByRole("button", { name: "Move 2 items" }));
  await waitFor(() => expect(mocks.move).toHaveBeenCalledTimes(1));
  expect(mocks.move).toHaveBeenCalledWith({ expectedUnits: { USD: 2 }, folderId: folders[1].id, itemIds: expect.arrayContaining([items[0].id, items[1].id]) });
  expect(mocks.createFolder).not.toHaveBeenCalled();
  // The selection is cleared once the rows are in the folder.
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getAllByRole("checkbox").some((box) => (box as HTMLInputElement).checked)).toBe(false);
});

it("creates a new folder first and moves into it", async () => {
  mocks.createFolder.mockResolvedValue({ ok: true });
  mocks.move.mockResolvedValue({ ok: true, moved: 1 });
  render(view());
  fireEvent.click(screen.getByRole("checkbox", { name: en.Items.selectRow.replace("{name}", "Charger") }));
  fireEvent.click(screen.getByRole("button", { name: en.Items.moveToFolder }));
  const sheet = await screen.findByRole("dialog");
  fireEvent.click(within(sheet).getByRole("radio", { name: en.Items.newFolder }));
  const confirm = within(sheet).getByRole("button", { name: "Move 1 item" }) as HTMLButtonElement;
  // A new folder needs a name before anything can be sent.
  expect(confirm.disabled).toBe(true);
  fireEvent.change(within(sheet).getByRole("textbox", { name: en.Invoices.folderName }), { target: { value: "  Desk  " } });
  fireEvent.click(confirm);
  await waitFor(() => expect(mocks.move).toHaveBeenCalledTimes(1));
  const created = mocks.createFolder.mock.calls[0][0];
  expect(created).toEqual({ id: expect.any(String), name: "Desk" });
  expect(mocks.move).toHaveBeenCalledWith({ expectedUnits: { USD: 2 }, folderId: created.id, itemIds: [items[2].id] });
});

it("offers only a new folder when there are none, and says why a move failed", async () => {
  mocks.createFolder.mockResolvedValue({ ok: false, error: "limitReached" });
  render(view("en", []));
  fireEvent.click(screen.getByRole("checkbox", { name: en.Items.selectRow.replace("{name}", "Milk") }));
  fireEvent.click(screen.getByRole("button", { name: en.Items.moveToFolder }));
  const sheet = await screen.findByRole("dialog");
  expect((within(sheet).getByRole("radio", { name: en.Items.newFolder }) as HTMLInputElement).checked).toBe(true);
  fireEvent.change(within(sheet).getByRole("textbox", { name: en.Invoices.folderName }), { target: { value: "Desk" } });
  fireEvent.click(within(sheet).getByRole("button", { name: "Move 1 item" }));
  expect((await within(sheet).findByRole("alert")).textContent).toBe(en.Items.errorFolderLimit);
  expect(mocks.move).not.toHaveBeenCalled();
});
