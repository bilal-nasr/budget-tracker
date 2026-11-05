// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { AppDataProvider } from "@/components/providers/app-data";
import type { WalletContainer } from "@/features/wallets/schema";
import { buildWalletDeletionPlan } from "@/features/wallets/deletion";
import type { CurrencyDefinition } from "@/lib/currency";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
const actions = vi.hoisted(() => ({ inspectWalletDeletion: vi.fn(), settleAndDeleteWallet: vi.fn() }));
vi.mock("@/features/wallets/actions", () => actions);
vi.mock("@/components/ui/sheet-shell", () => ({ SheetShell: ({ children, title }: { children: React.ReactNode; title: string }) => <div role="dialog" aria-label={title}>{children}</div> }));
import { WalletDeleteSheet } from "./wallet-delete-sheet";
const currencies: CurrencyDefinition[] = [{ code: "TOKEN", symbol: "◈", decimalPlaces: 8, disabled: false, firstUsed: true }, { code: "JPY", symbol: "¥", decimalPlaces: 0, disabled: false, firstUsed: true }];
const wallets: WalletContainer[] = ["source", "target"].map((id, index) => ({ id, name: id, kind: "cash", position: index, deleted: false, needsAttention: false, defaultBalanceId: `${id}-TOKEN`, balances: currencies.map((currency, position) => ({ id: `${id}-${currency.code}`, walletId: id, currency: currency.code, position, openingBalanceMinor: 0, balanceMinor: index === 0 ? position === 0 ? 123456789 : -5 : 0, detached: false })) }));
const done = vi.fn();
function mount(locale: "en" | "ar" = "en", source = wallets[0]) {
  const messages = locale === "en" ? en : ar;
  return render(<NextIntlClientProvider locale={locale} messages={messages}><AppDataProvider walletContainers={[source, wallets[1]]} currencies={currencies} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}><WalletDeleteSheet wallet={source} onClose={vi.fn()} onDeleted={done} /></AppDataProvider></NextIntlClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); actions.inspectWalletDeletion.mockResolvedValue({ ok: true, plan: buildWalletDeletionPlan("source", wallets, currencies, []) }); actions.settleAndDeleteWallet.mockResolvedValue({ ok: true }); });
afterEach(cleanup);
it.each(["en", "ar"] as const)("requires all counterparts, displays exact signed directions and submits one settlement (%s)", async (locale) => {
  const messages = locale === "en" ? en : ar;
  mount(locale);
  await waitFor(() => expect(actions.inspectWalletDeletion).toHaveBeenCalledWith("source"));
  const confirm = screen.getByRole("button", { name: messages.WalletDeletion.confirm });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  const selects = screen.getAllByRole("combobox");
  expect(screen.getByText(/1\.23456789/)).toBeTruthy();
  expect(screen.getByText("¥5")).toBeTruthy();
  fireEvent.change(selects[0], { target: { value: "target" } });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(selects[1], { target: { value: "target" } });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(confirm);
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(actions.settleAndDeleteWallet).toHaveBeenCalledWith(expect.any(String), "source", [{ balanceId: "source-TOKEN", counterpartBalanceId: "target-TOKEN", expectedAmountMinor: 123456789, expectedUnit: { code: "TOKEN", decimalPlaces: 8 } }, { balanceId: "source-JPY", counterpartBalanceId: "target-JPY", expectedAmountMinor: -5, expectedUnit: { code: "JPY", decimalPlaces: 0 } }]);
});
it("retains the exact token/payload on ambiguous failure and prevents editing it until retry or reload", async () => {
  actions.settleAndDeleteWallet.mockResolvedValueOnce({ ok: false, error: "failed" });
  mount();
  for (const select of screen.getAllByRole("combobox")) fireEvent.change(select, { target: { value: "target" } });
  const confirm = screen.getByRole("button", { name: en.WalletDeletion.confirm });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(confirm);
  await screen.findByRole("alert");
  expect(done).not.toHaveBeenCalled();
  for (const select of screen.getAllByRole("combobox")) expect((select as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: en.WalletDeletion.retry }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(actions.settleAndDeleteWallet.mock.calls[1]).toEqual(actions.settleAndDeleteWallet.mock.calls[0]);
});
it("blocks dependencies and offers inspection reload without mutation", async () => {
  actions.inspectWalletDeletion.mockResolvedValue({ ok: true, plan: buildWalletDeletionPlan("source", wallets, currencies, [{ kind: "fixedExpense", balanceId: "source-JPY", id: "rent", name: "Rent" }]) });
  mount();
  await screen.findByText(/Rent/);
  expect((screen.getByRole("button", { name: en.WalletDeletion.confirm }) as HTMLButtonElement).disabled).toBe(true);
  expect(actions.settleAndDeleteWallet).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: en.WalletDeletion.reload }));
  await waitFor(() => expect(actions.inspectWalletDeletion).toHaveBeenCalledTimes(2));
});
it("keeps demo selections preview-only when authenticated inspection is unavailable", async () => {
  actions.inspectWalletDeletion.mockResolvedValue({ ok: false, error: "notConfigured" });
  mount();
  expect((await screen.findByRole("alert")).textContent).toBe(en.WalletDeletion.preview);
  expect(screen.getAllByRole("combobox")).toHaveLength(2);
  expect((screen.getByRole("button", { name: en.WalletDeletion.confirm }) as HTMLButtonElement).disabled).toBe(true);
});
it("supports zero-balance Needs-attention recovery through the same atomic confirmation", async () => {
  const source = { ...wallets[0], needsAttention: true, balances: wallets[0].balances.map((balance) => ({ ...balance, balanceMinor: 0 })) };
  actions.inspectWalletDeletion.mockResolvedValue({ ok: true, plan: buildWalletDeletionPlan("source", [source, wallets[1]], currencies, []) });
  mount("en", source);
  expect(screen.getByText(en.WalletDeletion.recovery)).toBeTruthy();
  const confirm = screen.getByRole("button", { name: en.WalletDeletion.confirm });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(confirm);
  await waitFor(() => expect(actions.settleAndDeleteWallet).toHaveBeenCalledWith(expect.any(String), "source", [{ balanceId: "source-TOKEN", counterpartBalanceId: null, expectedAmountMinor: 0, expectedUnit: { code: "TOKEN", decimalPlaces: 8 } }, { balanceId: "source-JPY", counterpartBalanceId: null, expectedAmountMinor: 0, expectedUnit: { code: "JPY", decimalPlaces: 0 } }]));
});

