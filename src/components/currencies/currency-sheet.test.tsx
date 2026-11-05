// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { CurrencyDefinition } from "@/lib/currency";

const actions = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("@/features/currencies/actions", () => ({
  createCurrency: actions.create,
  updateCurrency: actions.update,
  deleteCurrency: actions.remove,
}));
vi.mock("@/components/ui/sheet-shell", () => ({
  SheetShell: ({ open, title, children, footer }: { open: boolean; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) => open ? <section aria-label={String(title)}>{children}{footer}</section> : null,
}));
import { CurrencySheet } from "./currency-sheet";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  actions.create.mockResolvedValue({ ok: true });
  actions.update.mockResolvedValue({ ok: true });
  actions.remove.mockResolvedValue({ ok: true });
});

const renderSheet = (currency: CurrencyDefinition | null, onOpenChange = vi.fn()) => {
  render(<NextIntlClientProvider locale="en" messages={en}><CurrencySheet open currency={currency} onOpenChange={onOpenChange} /></NextIntlClientProvider>);
  return onOpenChange;
};

it("validates code, symbol, and 0–8 precision while previewing runtime formatting", () => {
  renderSheet(null);
  const save = screen.getByRole("button", { name: en.CurrencySettings.save }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(en.CurrencySettings.code), { target: { value: " eur " } });
  fireEvent.change(screen.getByLabelText(en.CurrencySettings.symbol), { target: { value: "€" } });
  fireEvent.change(screen.getByLabelText(en.CurrencySettings.decimalPlaces), { target: { value: "9" } });
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(en.CurrencySettings.decimalPlaces), { target: { value: "2" } });
  expect(save.disabled).toBe(false);
  expect(screen.getByTestId("currency-preview").textContent).toContain("€1,234.56");
});

it("locks used code and precision while allowing a symbol edit", async () => {
  const currency: CurrencyDefinition = { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true };
  renderSheet(currency);
  expect((screen.getByLabelText(en.CurrencySettings.code) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText(en.CurrencySettings.decimalPlaces) as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(en.CurrencySettings.symbol), { target: { value: "US$" } });
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.save }));
  await waitFor(() => expect(actions.update).toHaveBeenCalledWith("USD", { code: "USD", symbol: "US$", decimalPlaces: 2 }));
});

it("keeps the sheet open and reports a failed save", async () => {
  actions.create.mockResolvedValue({ ok: false, error: "duplicateCurrency" });
  const close = renderSheet(null);
  fireEvent.change(screen.getByLabelText(en.CurrencySettings.code), { target: { value: "EUR" } });
  fireEvent.change(screen.getByLabelText(en.CurrencySettings.symbol), { target: { value: "€" } });
  fireEvent.change(screen.getByLabelText(en.CurrencySettings.decimalPlaces), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.save }));
  expect((await screen.findByRole("alert")).textContent).toContain(en.CurrencySettings.errorDuplicate);
  expect(close).not.toHaveBeenCalledWith(false);
});

it("requires confirmation before deleting an unused definition", async () => {
  const currency: CurrencyDefinition = { code: "JPY", symbol: "¥", decimalPlaces: 0, disabled: true, firstUsed: false };
  renderSheet(currency);
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.delete }));
  expect(actions.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: en.CurrencySettings.confirmDelete }));
  await waitFor(() => expect(actions.remove).toHaveBeenCalledWith("JPY"));
});
