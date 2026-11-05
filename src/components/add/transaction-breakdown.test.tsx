// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { AppDataProvider } from "@/components/providers/app-data";
import { emptyTransactionMetadata, type Transaction } from "@/features/transactions/schema";
import type { Wallet } from "@/features/wallets/schema";
import type { Category } from "@/features/categories/schema";
const mock = vi.hoisted(() => ({
  createTransaction: vi.fn(), createTransfer: vi.fn(), updateTransaction: vi.fn(), deleteTransaction: vi.fn(),
  restoreTransaction: vi.fn(), push: vi.fn(), toast: Object.assign(vi.fn(), { error: vi.fn() }), close: vi.fn(),
}));
vi.mock("@/features/transactions/actions", () => mock);
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
vi.mock("sonner", () => ({ toast: mock.toast }));
vi.mock("@/components/ui/sheet-shell", () => ({ SheetShell: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));
import { TransactionSheet, type ComposerState } from "./transaction-sheet";
import { DetailSheet } from "@/components/transactions/detail-sheet";

const id = "00000000-0000-4000-8000-000000000099";
const walletId = "00000000-0000-4000-8000-000000000001";
const categoryId = "00000000-0000-4000-8000-000000000101";
const wallets: Wallet[] = ["USD", "SYP", "LBP"].map((currency, n) => ({
  id: n === 0 ? walletId : `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
  name: n === 0 ? "Cash" : n === 1 ? "Syrian cash" : "Lebanese cash", currency: currency as Wallet["currency"],
  kind: "cash", position: n, archived: false, openingBalanceMinor: 0, balanceMinor: 10000,
}));
const categories: Category[] = [{ id: categoryId, kind: "expense", parentId: null, archivedAt: null,
  nameEn: "Other", nameAr: "أخرى", tile: 1, color: "teal", position: 1 }];
const saved: Transaction = {
  ...emptyTransactionMetadata(), id, kind: "expense", amountMinor: 5000, currency: "USD", walletId,
  categoryId, note: "Sister", createdAt: "2026-11-04T12:00:00Z", occurredOn: "2026-11-04",
  toWalletId: null, toAmountMinor: null, revision: 17,
  items: [{ id: "saved-line", description: "Phone credits", amountMinor: 2000, position: 0 }],
};
function wrap(children: React.ReactNode, locale: "en" | "ar" = "en") {
  return render(<NextIntlClientProvider locale={locale} messages={locale === "en" ? en : ar}>
    <AppDataProvider wallets={wallets} categories={categories} timezone="Asia/Beirut" salary={null} usdLbpRate={89500}>
      {children}
    </AppDataProvider>
  </NextIntlClientProvider>);
}
function mount(state: ComposerState = { mode: "add", draftId: id, preset: { categoryId } }, locale: "en" | "ar" = "en", onReload?: () => void) {
  return wrap(<TransactionSheet state={state} onClose={mock.close} onReload={onReload} />, locale);
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mock.createTransaction.mockResolvedValue({ ok: false, error: "notConfigured" });
  mock.updateTransaction.mockResolvedValue({ ok: true, id, revision: 22 });
  mock.deleteTransaction.mockResolvedValue({ ok: true, id, revision: 18 });
  mock.restoreTransaction.mockResolvedValue({ ok: true, id, revision: 19 });
});
afterEach(cleanup);

describe.each(["en", "ar"] as const)("%s optional expense composition", (locale) => {
  const messages = locale === "en" ? en : ar;
  it("keeps quick entry optional, submits parent payee with one partial item, and stays editable in demo", async () => {
    mount(undefined, locale);
    expect(screen.queryByLabelText(messages.Breakdown.description)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: "0" }));
    fireEvent.change(screen.getByLabelText(messages.Add.name), { target: { value: "Sister" } });
    fireEvent.click(screen.getByRole("button", { name: messages.Breakdown.title }));
    fireEvent.click(screen.getByRole("button", { name: messages.Breakdown.addItem }));
    fireEvent.change(screen.getByLabelText(messages.Breakdown.description), { target: { value: "Phone credits" } });
    fireEvent.change(screen.getByLabelText(messages.Breakdown.amount), { target: { value: "20" } });
    expect(screen.getByText("$30.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: messages.Add.save }));
    await waitFor(() => expect(mock.createTransaction).toHaveBeenCalledWith(expect.objectContaining({
      note: "Sister", amountMinor: 5000, categoryId, items: [{ description: "Phone credits", amountMinor: 2000 }],
    }), id));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(messages.Add.errorPreview));
    await waitFor(() => expect(screen.getByLabelText(messages.Add.name).matches(":disabled")).toBe(false));
    expect(mock.close).not.toHaveBeenCalled();
  });
  it("hydrates all items on edit, blocks an excess, and saves the original revision", async () => {
    mount({ mode: "edit", initial: saved }, locale);
    expect((screen.getByLabelText(messages.Add.name) as HTMLInputElement).value).toBe("Sister");
    expect((screen.getByLabelText(messages.Breakdown.description) as HTMLInputElement).value).toBe("Phone credits");
    fireEvent.change(screen.getByLabelText(messages.Breakdown.amount), { target: { value: "50.01" } });
    expect((screen.getByRole("button", { name: messages.Add.saveChanges }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(messages.Breakdown.amount), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: messages.Add.saveChanges }));
    await waitFor(() => expect(mock.updateTransaction).toHaveBeenCalledWith(id,
      expect.objectContaining({ note: "Sister", items: [{ description: "Phone credits", amountMinor: 3000 }] }), 17));
  });
});

it("retries an unknown create outcome with the same UUID/payload and guards create Undo with returned revision", async () => {
  mock.createTransaction.mockResolvedValueOnce({ ok: false, error: "failed" }).mockResolvedValueOnce({ ok: true, id, revision: 8 });
  const state: ComposerState = { mode: "add", draftId: id, initial: saved };
  const view = mount(state);
  fireEvent.click(screen.getByRole("button", { name: en.Add.save }));
  await screen.findByText(en.Breakdown.unknownOutcome);
  expect(screen.getByLabelText(en.Add.name).matches(":disabled")).toBe(true);
  // A catalogue refresh may archive the category after the first save committed.
  // Read-only same-ID reconciliation must still be reachable with the snapshot.
  view.rerender(<NextIntlClientProvider locale="en" messages={en}>
    <AppDataProvider wallets={wallets} categories={[]} timezone="Asia/Beirut" salary={null} usdLbpRate={89500}>
      <TransactionSheet state={state} onClose={mock.close} />
    </AppDataProvider>
  </NextIntlClientProvider>);
  expect((screen.getByRole("button", { name: en.Breakdown.retrySave }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: en.Breakdown.retrySave }));
  await waitFor(() => expect(mock.close).toHaveBeenCalledTimes(1));
  expect(mock.createTransaction.mock.calls[1]).toEqual(mock.createTransaction.mock.calls[0]);
  expect(mock.createTransaction.mock.calls[0][0]).not.toHaveProperty("source");
  await mock.toast.mock.calls.at(-1)![1].action.onClick();
  expect(mock.deleteTransaction).toHaveBeenCalledWith(id, 8);
});

it("keeps itemized expense currency and kind from changing silently", () => {
  mount({ mode: "edit", initial: saved });
  fireEvent.click(screen.getByRole("radio", { name: en.Add.income }));
  expect(screen.getByRole("alert").textContent).toContain(en.Breakdown.removeBeforeKindChange);
  fireEvent.click(screen.getByRole("button", { name: /Cash USD/ }));
  expect((screen.getByRole("radio", { name: /Syrian cash/ }) as HTMLButtonElement).disabled).toBe(true);
});

it("keeps exact unknown-outcome retry reachable when the final active wallet is archived", async () => {
  mock.createTransaction.mockResolvedValueOnce({ ok: false, error: "failed" })
    .mockResolvedValueOnce({ ok: true, id, revision: 1 });
  const state: ComposerState = { mode: "add", draftId: id, preset: { categoryId } };
  const view = mount(state);
  fireEvent.click(screen.getByRole("button", { name: "5" }));
  fireEvent.click(screen.getByRole("button", { name: "0" }));
  fireEvent.change(screen.getByLabelText(en.Add.name), { target: { value: "Pending expense" } });
  fireEvent.click(screen.getByRole("button", { name: en.Add.save }));
  await screen.findByText(en.Breakdown.unknownOutcome);
  view.rerender(<NextIntlClientProvider locale="en" messages={en}>
    <AppDataProvider wallets={wallets.map((wallet) => ({ ...wallet, archived: true }))} categories={[]}
      timezone="Asia/Beirut" salary={null} usdLbpRate={89500}>
      <TransactionSheet state={state} onClose={mock.close} />
    </AppDataProvider>
  </NextIntlClientProvider>);
  expect(screen.getByLabelText(en.Add.name).matches(":disabled")).toBe(true);
  const retry = screen.getByRole("button", { name: en.Breakdown.retrySave });
  expect((retry as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(retry);
  await waitFor(() => expect(mock.close).toHaveBeenCalledOnce());
  expect(mock.createTransaction.mock.calls[1]).toEqual(mock.createTransaction.mock.calls[0]);
  expect(mock.createTransaction.mock.calls[1][1]).toBe(id);
});

describe("revision-aware expense details", () => {
  it("retains payee and remainder, passes all item data to duplicate, and restores only the deletion revision", async () => {
    const duplicate = vi.fn();
    wrap(<DetailSheet transaction={saved} onClose={mock.close} onEdit={vi.fn()} onDuplicate={duplicate} />);
    expect(screen.getByText("Sister").tagName).toBe("BDI");
    expect(screen.getByText("$30.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en.Detail.duplicate }));
    expect(duplicate).toHaveBeenCalledWith(saved);
    fireEvent.click(screen.getByRole("button", { name: en.Detail.delete }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalled());
    expect(mock.deleteTransaction).toHaveBeenCalledWith(id, 17);
    await mock.toast.mock.calls.at(-1)![1].action.onClick();
    expect(mock.restoreTransaction).toHaveBeenCalledWith(id, 18);
  });
  it("keeps the detail open when its captured revision conflicts", async () => {
    mock.deleteTransaction.mockResolvedValue({ ok: false, error: "conflict" });
    wrap(<DetailSheet transaction={saved} onClose={mock.close} onEdit={vi.fn()} onDuplicate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: en.Detail.delete }));
    await waitFor(() => expect(mock.toast.error).toHaveBeenCalledWith(en.Breakdown.conflict));
    expect(mock.close).not.toHaveBeenCalled();
  });
  it.each([
    { id: walletId, revision: 1 },
    { id, revision: 24 },
  ])("scopes a detail conflict to its captured row and revision when shown $id at revision $revision", async (snapshot) => {
    mock.deleteTransaction.mockResolvedValue({ ok: false, error: "conflict" });
    const view = wrap(<DetailSheet transaction={saved} onClose={mock.close} onEdit={vi.fn()} onDuplicate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: en.Detail.delete }));
    await screen.findByText(en.Breakdown.conflict);
    view.rerender(<NextIntlClientProvider locale="en" messages={en}>
      <AppDataProvider wallets={wallets} categories={categories} timezone="Asia/Beirut" salary={null} usdLbpRate={89500}>
        <DetailSheet transaction={{ ...saved, ...snapshot, note: "Freshly selected snapshot" }}
          onClose={mock.close} onEdit={vi.fn()} onDuplicate={vi.fn()} />
      </AppDataProvider>
    </NextIntlClientProvider>);
    expect((screen.getByRole("button", { name: en.Detail.delete }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: en.Breakdown.reload })).toBeNull();
  });
});

describe.each(["en", "ar"] as const)("%s explicit conflict recovery", (locale) => {
  const m = locale === "ar" ? ar : en;
  const reloadLabel = locale === "ar" ? "إعادة تحميل أحدث البيانات" : "Reload latest data";
  it("offers Reload when create Undo conflicts after the composer closes", async () => {
    const reload = vi.fn();
    mock.createTransaction.mockResolvedValue({ ok: true, id, revision: 18 });
    mock.deleteTransaction.mockResolvedValue({ ok: false, error: "conflict" });
    const page = mount({ mode: "add", draftId: id, initial: saved }, locale, reload);
    fireEvent.click(screen.getByRole("button", { name: m.Add.save }));
    await waitFor(() => expect(mock.close).toHaveBeenCalledOnce());
    const undo = mock.toast.mock.calls.at(-1)![1].action.onClick;
    page.unmount();
    await undo();
    expect(mock.deleteTransaction).toHaveBeenCalledWith(id, 18);
    expect(mock.toast.error).toHaveBeenCalledWith(m.Breakdown.conflict, {
      action: { label: reloadLabel, onClick: reload },
    });
    mock.toast.error.mock.calls.at(-1)![1].action.onClick();
    expect(reload).toHaveBeenCalledOnce();
  });
  it("offers Reload when restore Undo conflicts after the detail closes", async () => {
    const reload = vi.fn();
    mock.restoreTransaction.mockResolvedValue({ ok: false, error: "conflict" });
    const page = wrap(<DetailSheet transaction={saved} onClose={mock.close}
      onEdit={vi.fn()} onDuplicate={vi.fn()} onReload={reload} />, locale);
    fireEvent.click(screen.getByRole("button", { name: m.Detail.delete }));
    await waitFor(() => expect(mock.close).toHaveBeenCalledOnce());
    const undo = mock.toast.mock.calls.at(-1)![1].action.onClick;
    page.unmount();
    await undo();
    expect(mock.restoreTransaction).toHaveBeenCalledWith(id, 18);
    expect(mock.toast.error).toHaveBeenCalledWith(m.Breakdown.conflict, {
      action: { label: reloadLabel, onClick: reload },
    });
    mock.toast.error.mock.calls.at(-1)![1].action.onClick();
    expect(reload).toHaveBeenCalledOnce();
  });
  it("preserves the draft until Reload, then retries an edit only from the new server snapshot", async () => {
    const reload = vi.fn();
    mock.updateTransaction.mockResolvedValueOnce({ ok: false, error: "conflict" })
      .mockResolvedValueOnce({ ok: true, id, revision: 25 });
    const oldPage = mount({ mode: "edit", initial: saved }, locale, reload);
    fireEvent.change(screen.getByLabelText(m.Add.name), { target: { value: "My unsaved draft" } });
    fireEvent.click(screen.getByRole("button", { name: m.Add.saveChanges }));
    await screen.findByText(m.Breakdown.conflict);
    expect((screen.getByLabelText(m.Add.name) as HTMLInputElement).value).toBe("My unsaved draft");
    expect(mock.close).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    const reloadButton = screen.getByRole("button", { name: reloadLabel });
    await waitFor(() => expect((reloadButton as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole("button", { name: m.Add.saveChanges }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(reloadButton);
    expect(reload).toHaveBeenCalledOnce();
    // Model a full new server response. It replaces stale client-held objects;
    // refresh alone would preserve ComposerProvider's old initial snapshot.
    oldPage.unmount();
    mount({ mode: "edit", initial: { ...saved, revision: 24, note: "Latest server name" } }, locale);
    expect((screen.getByLabelText(m.Add.name) as HTMLInputElement).value).toBe("Latest server name");
    fireEvent.click(screen.getByRole("button", { name: m.Add.saveChanges }));
    await waitFor(() => expect(mock.updateTransaction.mock.calls[1]?.[2]).toBe(24));
    expect(mock.updateTransaction.mock.calls[0][2]).toBe(17);
  });
  it("keeps a conflicting detail open until Reload and deletes only the fresh snapshot revision", async () => {
    const reload = vi.fn();
    mock.deleteTransaction.mockResolvedValueOnce({ ok: false, error: "conflict" })
      .mockResolvedValueOnce({ ok: true, id, revision: 25 });
    const oldPage = wrap(<DetailSheet transaction={saved} onClose={mock.close}
      onEdit={vi.fn()} onDuplicate={vi.fn()} onReload={reload} />, locale);
    fireEvent.click(screen.getByRole("button", { name: m.Detail.delete }));
    await screen.findByText(m.Breakdown.conflict);
    expect(mock.close).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: m.Detail.delete }) as HTMLButtonElement).disabled).toBe(true);
    const reloadButton = screen.getByRole("button", { name: reloadLabel });
    await waitFor(() => expect((reloadButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(reloadButton);
    expect(reload).toHaveBeenCalledOnce();
    oldPage.unmount();
    wrap(<DetailSheet transaction={{ ...saved, revision: 24, note: "Latest server name" }} onClose={mock.close}
      onEdit={vi.fn()} onDuplicate={vi.fn()} />, locale);
    fireEvent.click(screen.getByRole("button", { name: m.Detail.delete }));
    await waitFor(() => expect(mock.deleteTransaction.mock.calls[1]).toEqual([id, 24]));
    expect(mock.deleteTransaction.mock.calls[0]).toEqual([id, 17]);
  });
});

describe("cashier aggregate integration", () => {
  const cashSaved: Transaction = { ...saved, amountMinor: 1250,
    items: [{ ...saved.items[0], amountMinor: 1000 }],
    settlement: { tenderMinor: 2000, tenderCurrency: "USD", changes: [
      { walletId, amountMinor: 500, currency: "USD" },
      { walletId: wallets[1].id, amountMinor: 32500, currency: "SYP",
        rate: { base: "USD", quote: "SYP", quoteMajorNumerator: 13000, quoteMajorDenominator: 1 } },
    ] },
  };
  it.each([
    ["en", "Payment style", "Standard", "Cash purchase"],
    ["ar", "طريقة الدفع", "عادي", "شراء نقدي"],
  ] as const)("%s exposes cashier as a secondary Expense mode", (locale, group, standard, cashPurchase) => {
    const m = locale === "ar" ? ar : en;
    mount(undefined, locale);
    const mode = screen.getByRole("radiogroup", { name: group });
    expect(mode).toBeTruthy();
    expect((screen.getByRole("radio", { name: standard }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText(m.Cashier.tender)).toBeNull();
    expect(screen.queryByRole("checkbox", { name: m.Cashier.title })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: cashPurchase }));
    expect((screen.getByRole("radio", { name: cashPurchase }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("combobox", { name: m.Cashier.purchaseCurrency })).toBeTruthy();
    expect(screen.getByLabelText(m.Cashier.tender)).toBeTruthy();
  });
  it("records exact LBP cost, USD tender, and LBP change without a rate", async () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Cash purchase" }));
    fireEvent.change(screen.getByRole("combobox", { name: en.Cashier.purchaseCurrency }), { target: { value: "LBP" } });
    for (const digit of "340000") fireEvent.click(screen.getByRole("button", { name: digit }));
    fireEvent.change(screen.getByLabelText(en.Cashier.tender), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: en.Cashier.addChange }));
    fireEvent.change(screen.getByRole("combobox", { name: en.Cashier.currency }), { target: { value: "LBP" } });
    fireEvent.change(screen.getByLabelText(en.Cashier.change), { target: { value: "110000" } });
    fireEvent.change(screen.getByRole("combobox", { name: en.Cashier.wallet }), { target: { value: wallets[2].id } });
    fireEvent.click(screen.getByRole("button", { name: en.Add.save }));
    await waitFor(() => expect(mock.createTransaction).toHaveBeenCalledWith(expect.objectContaining({
      amountMinor: 340000, costCurrency: "LBP",
      settlement: { tenderMinor: 500, changes: [{ walletId: wallets[2].id, amountMinor: 110000 }] },
    }), id));
    expect(screen.queryByLabelText(en.Cashier.rate)).toBeNull();
  });
  it.each(["en", "ar"] as const)("%s hydrates every return, keeps cost/items separate and saves one captured revision", async (locale) => {
    const m = locale === "ar" ? ar : en;
    mount({ mode: "edit", initial: cashSaved }, locale);
    expect((screen.getByRole("radio", { name: locale === "ar" ? "شراء نقدي" : "Cash purchase" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(m.Cashier.tender) as HTMLInputElement).value).toBe("20");
    expect(screen.getAllByLabelText(m.Cashier.change).map((input) => (input as HTMLInputElement).value)).toEqual(["5", "32500"]);
    expect(screen.queryByLabelText(m.Cashier.rate)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: m.Add.saveChanges }));
    await waitFor(() => expect(mock.updateTransaction).toHaveBeenCalledWith(id, expect.objectContaining({
      amountMinor: 1250, items: [{ description: "Phone credits", amountMinor: 1000 }],
      settlement: { tenderMinor: 2000, changes: [
        { walletId, amountMinor: 500 },
        { walletId: wallets[1].id, amountMinor: 32500,
          rate: { base: "USD", quote: "SYP", quoteMajorNumerator: 13000, quoteMajorDenominator: 1 } },
      ] },
    }), 17));
    expect(mock.updateTransaction).toHaveBeenCalledOnce();
  });
  it("clears settlement explicitly without discarding descriptive items", async () => {
    mount({ mode: "edit", initial: cashSaved });
    fireEvent.click(screen.getByRole("radio", { name: "Standard" }));
    fireEvent.click(screen.getByRole("button", { name: en.Add.saveChanges }));
    await waitFor(() => expect(mock.updateTransaction).toHaveBeenCalledWith(id, expect.objectContaining({ settlement: null,
      amountMinor: 1250, items: [{ description: "Phone credits", amountMinor: 1000 }],
    }), 17));
  });
  it("clears a saved cross-currency override after aligning cost with the payer", async () => {
    const crossSaved: Transaction = {
      ...cashSaved,
      amountMinor: 340000,
      currency: "LBP",
      items: [],
      settlement: { tenderMinor: 500, tenderCurrency: "USD", changes: [
        { walletId: wallets[2].id, amountMinor: 110000, currency: "LBP" },
      ] },
    };
    mount({ mode: "edit", initial: crossSaved });
    fireEvent.change(screen.getByRole("combobox", { name: en.Cashier.purchaseCurrency }), { target: { value: "USD" } });
    for (const digit of "34") fireEvent.click(screen.getByRole("button", { name: digit }));
    fireEvent.click(screen.getByRole("radio", { name: "Standard" }));
    fireEvent.click(screen.getByRole("button", { name: en.Add.saveChanges }));
    await waitFor(() => expect(mock.updateTransaction).toHaveBeenCalledWith(id, expect.objectContaining({
      costCurrency: "USD", settlement: null,
    }), 17));
  });
  it("keeps Cash purchase selected when cross-currency facts cannot be removed safely", () => {
    const crossSaved: Transaction = {
      ...cashSaved,
      amountMinor: 340000,
      currency: "LBP",
      items: [],
      settlement: { tenderMinor: 500, tenderCurrency: "USD", changes: [
        { walletId: wallets[2].id, amountMinor: 110000, currency: "LBP" },
      ] },
    };
    mount({ mode: "edit", initial: crossSaved });
    fireEvent.click(screen.getByRole("radio", { name: "Standard" }));
    expect((screen.getByRole("radio", { name: "Cash purchase" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Match the purchase currency to the paying wallet before switching to Standard.");
  });
  it("duplicates actual cash without rate confirmation and submits the fresh draft UUID", async () => {
    const fresh = "00000000-0000-4000-8000-000000000098";
    mount({ mode: "add", initial: cashSaved, draftId: fresh });
    expect((screen.getByRole("button", { name: en.Add.save }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("checkbox", { name: en.Cashier.confirmRate })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: en.Add.save }));
    await waitFor(() => expect(mock.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 1250,
      settlement: expect.objectContaining({ tenderMinor: 2000 }),
    }), fresh));
  });
  it("keeps the cashier draft without a wallet-creation prompt", () => {
    const openWallet = vi.fn();
    wrap(<TransactionSheet state={{ mode: "edit", initial: cashSaved }} onClose={mock.close} onCreateWallet={openWallet} />);
    expect(screen.queryByRole("button", { name: en.Cashier.createWallet })).toBeNull();
    expect(openWallet).not.toHaveBeenCalled();
    expect(mock.close).not.toHaveBeenCalled();
    expect((screen.getByLabelText(en.Cashier.tender) as HTMLInputElement).value).toBe("20");
  });
  it("leaves fixed/installment editing item-aware without exposing cashier fields", () => {
    mount({ mode: "edit", initial: { ...saved, source: "installment", installmentId: "plan" } });
    expect(screen.queryByRole("checkbox", { name: en.Cashier.title })).toBeNull();
    expect((screen.getByLabelText(en.Breakdown.description) as HTMLInputElement).value).toBe("Phone credits");
  });
});
