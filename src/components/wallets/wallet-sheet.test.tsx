// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { AppDataProvider } from "@/components/providers/app-data";
import type { CurrencyDefinition } from "@/lib/currency";
import type { WalletContainer } from "@/features/wallets/schema";
const actions = vi.hoisted(() => ({ createWallet: vi.fn(), updateWallet: vi.fn(), setDefaultWalletBalance: vi.fn() }));
vi.mock("@/features/wallets/actions", () => actions);
import { WalletForm } from "./wallet-sheet";
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); Object.values(actions).forEach((action) => action.mockResolvedValue({ ok: true })); });
const currencies: CurrencyDefinition[] = [
  { code: "TOKEN", symbol: "◈", decimalPlaces: 8, disabled: false, firstUsed: false },
  { code: "EUR", symbol: "€", decimalPlaces: 2, disabled: false, firstUsed: true },
  { code: "JPY", symbol: "¥", decimalPlaces: 0, disabled: true, firstUsed: false },
];
const wallet: WalletContainer = { id: "pocket", name: "Pocket", kind: "cash", position: 0, deleted: false, needsAttention: false, defaultBalanceId: "eur-balance", balances: currencies.map((currency, index) => ({ id: currency.code === "EUR" ? "eur-balance" : `${currency.code}-balance`, currency: currency.code, walletId: "pocket", openingBalanceMinor: 50, balanceMinor: 55, position: index, detached: false })) };
function wrap(child: React.ReactNode, provider = true) {
 return render(<NextIntlClientProvider locale="en" messages={en}>{provider ? <AppDataProvider walletContainers={[wallet]} currencies={currencies} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}>{child}</AppDataProvider> : child}</NextIntlClientProvider>);
}
it("creates via the global action with first catalog default and exact optional signed custom opening", async () => {
  const done = vi.fn();
  wrap(<WalletForm wallet={null} onDone={done} />);
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("TOKEN");
  fireEvent.change(screen.getByLabelText(en.Wallets.name), { target: { value: "Travel" } });
  fireEvent.change(screen.getByLabelText(en.Wallets.amount), { target: { value: "١٫٢٣٤٥٦٧٨٩" } });
  fireEvent.click(screen.getByRole("radio", { name: en.Wallets.owe }));
  fireEvent.click(screen.getByRole("button", { name: en.Wallets.create }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(actions.createWallet).toHaveBeenCalledWith({ expectedUnits: { TOKEN: 8 }, name: "Travel", kind: "cash", currency: "TOKEN", openingBalanceMinor: -123456789 });
  expect(screen.queryByText(en.Wallets.sourceTitle)).toBeNull();
});
it("edits metadata and the exact enabled default without opening-balance or per-wallet currency controls", async () => {
  const done = vi.fn();
  wrap(<WalletForm wallet={wallet} onDone={done} />);
  expect(screen.queryByLabelText(en.Wallets.amount)).toBeNull();
  expect(screen.queryByRole("button", { name: en.Wallets.archive })).toBeNull();
  expect(screen.queryByRole("option", { name: "JPY" })).toBeNull();
  fireEvent.change(screen.getByLabelText(en.Wallets.name), { target: { value: "Updated" } });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "TOKEN" } });
  fireEvent.click(screen.getByRole("button", { name: en.Wallets.saveChanges }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(actions.updateWallet).toHaveBeenCalledWith("pocket", { name: "Updated", kind: "cash" });
  expect(actions.setDefaultWalletBalance).toHaveBeenCalledWith("pocket", "TOKEN-balance");
});
it("retains the form and saved default when a default change fails", async () => {
  const done = vi.fn(); actions.setDefaultWalletBalance.mockResolvedValue({ ok: false, error: "failed" });
  wrap(<WalletForm wallet={wallet} onDone={done} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "TOKEN" } });
  fireEvent.click(screen.getByRole("button", { name: en.Wallets.saveChanges }));
  await screen.findByRole("alert");
  expect(done).not.toHaveBeenCalled();
  expect(wallet.defaultBalanceId).toBe("eur-balance");
});
it("accepts an explicit runtime catalog for onboarding outside the app provider", async () => {
  wrap(<WalletForm wallet={null} currencies={currencies} onDone={vi.fn()} />, false);
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("TOKEN");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "EUR" } });
  fireEvent.change(screen.getByLabelText(en.Wallets.name), { target: { value: "First" } });
  fireEvent.click(screen.getByRole("button", { name: en.Wallets.create }));
  await waitFor(() => expect(actions.createWallet).toHaveBeenCalledWith({ expectedUnits: { EUR: 2 }, name: "First", kind: "cash", currency: "EUR", openingBalanceMinor: 0 }));
});

it.each(["disabled", "precision"])("clears the opening amount after a %s currency refresh", async (change) => {
  const done = vi.fn();
  const view = (catalog: CurrencyDefinition[]) => <NextIntlClientProvider locale="en" messages={en}><WalletForm wallet={null} currencies={catalog} onDone={done} /></NextIntlClientProvider>;
  const rendered = render(view(currencies));
  fireEvent.change(screen.getByLabelText(en.Wallets.name), { target: { value: "First" } });
  fireEvent.change(screen.getByLabelText(en.Wallets.amount), { target: { value: "1.23" } });
  rendered.rerender(view(currencies.map((currency) => currency.code === "TOKEN" ? { ...currency, disabled: change === "disabled", decimalPlaces: change === "precision" ? 2 : 8 } : currency)));
  expect((screen.getByLabelText(en.Wallets.amount) as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: en.Wallets.create }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(actions.createWallet).toHaveBeenCalledWith({ expectedUnits: change === "disabled" ? { EUR: 2 } : { TOKEN: 2 }, name: "First", kind: "cash", currency: change === "disabled" ? "EUR" : "TOKEN", openingBalanceMinor: 0 });
});

it.each(["disabled", "precision"])("does not restore an opening draft after a %s catalog round trip", async (change) => {
  const done = vi.fn();
  const view = (catalog: CurrencyDefinition[]) => <NextIntlClientProvider locale="en" messages={en}><WalletForm wallet={null} currencies={catalog} onDone={done} /></NextIntlClientProvider>;
  const rendered = render(view(currencies));
  fireEvent.change(screen.getByLabelText(en.Wallets.name), { target: { value: "First" } });
  fireEvent.change(screen.getByLabelText(en.Wallets.amount), { target: { value: "1.23456789" } });
  rendered.rerender(view(currencies.map((currency) => currency.code === "TOKEN" ? { ...currency, disabled: change === "disabled", decimalPlaces: change === "precision" ? 2 : 8 } : currency)));
  expect((screen.getByLabelText(en.Wallets.amount) as HTMLInputElement).value).toBe("");
  rendered.rerender(view(currencies));
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("TOKEN");
  expect((screen.getByLabelText(en.Wallets.amount) as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: en.Wallets.create }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(actions.createWallet).toHaveBeenCalledWith({ expectedUnits: { TOKEN: 8 }, name: "First", kind: "cash", currency: "TOKEN", openingBalanceMinor: 0 });
});
