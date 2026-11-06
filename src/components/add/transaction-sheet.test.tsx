import { completeFixtureWallets } from "@/test/balance-fixtures";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { AppDataProvider } from "@/components/providers/app-data";
import type { Category } from "@/features/categories/schema";
import { emptyTransactionMetadata, type Transaction } from "@/features/transactions/schema";
import type { BalanceFixture as Wallet } from "@/test/balance-fixtures";

const mocks = vi.hoisted(() => ({ createTransfer: vi.fn(), createTransaction: vi.fn(), deleteTransaction: vi.fn(), updateTransaction: vi.fn(), push: vi.fn() }));
vi.mock("@/features/transactions/actions", () => mocks);
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/components/ui/sheet-shell", () => ({ SheetShell: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));
import { TransactionSheet, type ComposerState } from "./transaction-sheet";

const wallet = (n: number, name: string, currency: Wallet["currency"], balanceMinor: number): Wallet => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, name, currency,
  kind: "cash", position: n, openingBalanceMinor: 0, balanceMinor, archived: false,
});
const wallets = [
  wallet(1, "Cash", "USD", 123456),
  wallet(2, "Bank", "USD", 250000),
  wallet(3, "Cash", "LBP", 5000000),
  wallet(6, "Syrian cash", "SYP", -7500),
  wallet(7, "Syrian bank", "SYP", 8000),
];
const expenseCategory: Category = {
  id: "00000000-0000-4000-8000-000000000101",
  kind: "expense",
  parentId: null,
  archivedAt: null,
  nameEn: "Other",
  nameAr: "أخرى",
  tile: 1,
  color: "teal",
  position: 1,
};
const editedTransaction: Transaction = {
  ...emptyTransactionMetadata(),
  id: "00000000-0000-4000-8000-000000000098",
  kind: "expense",
  occurredOn: "2026-11-05",
  amountMinor: 100,
  currency: "USD",
  balanceId: wallets[0].id,
  categoryId: null,
  toBalanceId: null,
  toAmountMinor: null,
  note: null,
  createdAt: "2026-11-05T10:00:00Z",
};
function mount(
  locale: "en" | "ar" = "en",
  rate: number | null = 89500,
  state: React.ComponentProps<typeof TransactionSheet>["state"] = {
    mode: "add",
    draftId: "00000000-0000-4000-8000-000000000099",
    preset: { kind: "move" },
  },
) {
  const messages = locale === "en" ? en : ar;
  render(<NextIntlClientProvider locale={locale} messages={messages}>
    <AppDataProvider walletContainers={completeFixtureWallets(wallets)} currencies={[...SEED_CURRENCY_DEFINITIONS]} categories={[expenseCategory]} timezone="Asia/Beirut" salary={null} usdLbpRate={rate}>
      <TransactionSheet state={state} onClose={vi.fn()} />
    </AppDataProvider>
  </NextIntlClientProvider>);
  return messages.Add;
}
async function choose(label: string, option: RegExp) {
  const chosen = wallets.find((wallet) => option.test(`${wallet.name} ${wallet.currency}`));
  if (!chosen) throw new Error("Unknown test wallet");
  fireEvent.change(screen.getByRole("combobox", { name: label }), { target: { value: chosen.id } });
}
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
beforeEach(() => {
  localStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mocks.createTransfer.mockResolvedValue({ ok: false, error: "notConfigured" });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe.each(["en", "ar"] as const)("%s selected wallet balances", (locale) => {
  const balance = locale === "en" ? "Balance" : "الرصيد";

  it("shows and updates the selected balance for expense and income", () => {
    const t = mount(locale, 89500, {
      mode: "add",
      draftId: "00000000-0000-4000-8000-000000000091",
      preset: { kind: "expense" },
    });
    expect(screen.getByText(balance)).toBeTruthy();
    expect(screen.getByText("$1,234.56")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Cash USD/ }));
    fireEvent.change(screen.getByRole("combobox", { name: t.wallet }), { target: { value: wallets[1].id } });
    expect(screen.queryByText("$1,234.56")).toBeNull();
    expect(screen.getByText("$2,500.00")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: t.income }));
    expect(screen.getByText(balance)).toBeTruthy();
    expect(screen.getByText("$2,500.00")).toBeTruthy();
  });

  it("shows and independently updates both selected Move wallet balances", async () => {
    const t = mount(locale);
    expect(screen.getAllByText(balance)).toHaveLength(1);
    expect(screen.getByText("$1,234.56")).toBeTruthy();

    await choose(t.to, /Bank USD/);
    expect(screen.getAllByText(balance)).toHaveLength(2);
    expect(screen.getByText("$2,500.00")).toBeTruthy();

    await choose(t.from, /Cash LBP/);
    expect(screen.queryByText("$1,234.56")).toBeNull();
    expect(screen.getByText("LBP 5,000,000")).toBeTruthy();
    expect(screen.getByText("$2,500.00")).toBeTruthy();

    await choose(t.to, /Syrian bank SYP/);
    expect(screen.getByText("LBP 5,000,000")).toBeTruthy();
    expect(screen.queryByText("$2,500.00")).toBeNull();
    expect(screen.getByText("SYP 8,000")).toBeTruthy();
  });

  it("formats a negative selected wallet balance", async () => {
    const t = mount(locale);
    await choose(t.from, /Syrian cash SYP/);
    expect(screen.getByText("−SYP 7,500")).toBeTruthy();
  });

  it("does not show selected wallet balances while editing", () => {
    mount(locale, 89500, { mode: "edit", initial: editedTransaction });
    expect(screen.queryByText(balance)).toBeNull();
  });
});

describe.each(["en", "ar"] as const)("%s expense balance warning", (locale) => {
  const warning = locale === "en"
    ? "This expense exceeds this wallet's balance."
    : "هذا المصروف يتجاوز رصيد هذه المحفظة.";

  it("warns above the selected wallet balance without blocking save", () => {
    const t = mount(locale, 89500, {
      mode: "add",
      draftId: "00000000-0000-4000-8000-000000000092",
      preset: { kind: "expense", categoryId: expenseCategory.id },
    });
    for (const key of ["1", "2", "3", "4", ".", "5", "6"]) {
      fireEvent.click(screen.getByRole("button", { name: key }));
    }
    expect(screen.queryByText(warning)).toBeNull();
    expect((screen.getByRole("button", { name: t.save }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: t.backspace }));
    fireEvent.click(screen.getByRole("button", { name: "7" }));
    expect(screen.getByRole("status").textContent).toBe(warning);
    expect((screen.getByRole("button", { name: t.save }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("radio", { name: t.income }));
    expect(screen.queryByText(warning)).toBeNull();
  });
});

describe.each(["en", "ar"] as const)("%s Move received ownership", (locale) => {
  it("locks calculation, explicitly unlocks/focuses, preserves deletion, and resumes locked calculation", async () => {
    const t = mount(locale);
    await choose(t.to, /Cash LBP/);
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    const receivedLabel = t.received.replace("{currency}", "LBP");
    const received = input(receivedLabel);
    expect(received.readOnly).toBe(true);
    expect(received.value).toBe("89500");
    fireEvent.click(screen.getByRole("button", { name: t.editReceived }));
    expect(received.readOnly).toBe(false);
    expect(document.activeElement).toBe(received);
    fireEvent.change(received, { target: { value: "89000" } });
    fireEvent.change(input(t.rate), { target: { value: "90000" } });
    expect(received.value).toBe("89000");
    fireEvent.change(received, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "0" }));
    expect(received.value).toBe("");
    expect((screen.getByRole("button", { name: t.moveSave }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: t.useRate }));
    expect(received.readOnly).toBe(true);
    expect(received.value).toBe("900000");
  });
  it("provides a blank locked SYP path, preserves raw manual drafts and resets on pair change", async () => {
    const t = mount(locale);
    await choose(t.to, /Syrian cash SYP/);
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    const received = input(t.received.replace("{currency}", "SYP"));
    expect(received.readOnly).toBe(true);
    expect(received.value).toBe("");
    expect(screen.queryByLabelText(t.rate)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.editReceived }));
    fireEvent.change(received, { target: { value: "١٢٫" } });
    fireEvent.click(screen.getByRole("button", { name: t.editReceived }));
    expect(received.value).toBe("١٢٫");
    await choose(t.to, /Syrian bank SYP/);
    expect(received.value).toBe("١٢٫");
    expect(received.readOnly).toBe(false);
    fireEvent.change(received, { target: { value: "١٢٥٠" } });
    fireEvent.click(screen.getByRole("button", { name: t.moveSave }));
    await waitFor(() => expect(mocks.createTransfer).toHaveBeenCalledWith(expect.objectContaining({ receivedMinor: 1250, rate: undefined })));
    await choose(t.to, /Cash LBP/);
    expect(input(t.received.replace("{currency}", "LBP")).readOnly).toBe(true);
    expect(input(t.received.replace("{currency}", "LBP")).value).toBe("89500");
  });
  it("allows manual actual received when the USD/LBP rate is missing", async () => {
    const t = mount(locale, null);
    await choose(t.to, /Cash LBP/);
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    const received = input(t.received.replace("{currency}", "LBP"));
    expect(received.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: t.editReceived }));
    fireEvent.change(received, { target: { value: "12345" } });
    expect((screen.getByRole("button", { name: t.moveSave }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: t.useRate }));
    expect(received.readOnly).toBe(true);
    expect(received.value).toBe("");
  });
});

describe("canonical runtime composer", () => {
  const codeId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const definitions = [
    { code:"USD", symbol:"$", decimalPlaces:2, disabled:false, firstUsed:false },
    { code:"TOK", symbol:"T", decimalPlaces:8, disabled:false, firstUsed:false },
    { code:"OLD", symbol:"O", decimalPlaces:0, disabled:true, firstUsed:true },
  ];
  const containers = [1,2].map(n => ({ id:codeId(800+n),name:n===1?"Pocket":"Bank",kind:"cash" as const,position:n,deleted:false,needsAttention:false,
    defaultBalanceId:codeId(900+n*10+1),balances:definitions.map((c,index)=>({id:codeId(900+n*10+index),walletId:codeId(800+n),currency:c.code,position:index,balanceMinor:123456789,openingBalanceMinor:0,detached:false})) }));
  const incomeCategory = {...expenseCategory,id:codeId(888),kind:"income" as const};
  function canonical(kind: "income"|"expense"|"move"|"exchange") {
    render(<NextIntlClientProvider locale="en" messages={en}><AppDataProvider walletContainers={containers} currencies={definitions} categories={[expenseCategory,incomeCategory]} timezone="UTC" salary={null} usdLbpRate={null}>
      <TransactionSheet state={{mode:"add",draftId:codeId(999),preset:{kind,walletId:containers[0].id,categoryId:kind==="income"?incomeCategory.id:expenseCategory.id}}} onClose={vi.fn()}/>
    </AppDataProvider></NextIntlClientProvider>);
  }
  it.each(["expense","income"] as const)("uses a custom default from canonical Add money preset for %s and emits its exact row", async kind=>{
    canonical(kind);
    expect(screen.getByText("T 1.23456789")).toBeTruthy();
    for(const key of ["1",".","2","3","4","5","6","7","8","9"]) fireEvent.click(screen.getByRole("button",{name:key}));
    fireEvent.click(screen.getByRole("button",{name:en.Add.save}));
    await waitFor(()=>expect(mocks.createTransaction).toHaveBeenCalledWith(expect.objectContaining({balanceId:containers[0].defaultBalanceId,amountMinor:123456789,kind}),codeId(999)));
  });
  it("supports same-wallet Exchange, excludes same row and disabled history, and resets source precision drafts", async()=>{
    canonical("exchange");
    expect((screen.getByRole("combobox",{name:en.Add.fromCurrency}) as HTMLSelectElement).value).toBe(containers[0].defaultBalanceId);
    expect(screen.queryByRole("option",{name:"OLD"})).toBeNull();
    fireEvent.change(screen.getByRole("combobox",{name:en.Add.to}),{target:{value:containers[0].id}});
    const destination = screen.getByRole("combobox",{name:en.Add.toCurrency}) as HTMLSelectElement;
    expect(destination.value).toBe(containers[0].balances[0].id);
    expect(Array.from(destination.options).map(o=>o.value)).not.toContain(containers[0].defaultBalanceId);
    fireEvent.click(screen.getByRole("button",{name:"1"}));
    fireEvent.click(screen.getByRole("button",{name:en.Add.editReceived}));
    fireEvent.change(input(en.Add.received.replace("{currency}","USD")),{target:{value:"2.50"}});
    fireEvent.click(screen.getByRole("button",{name:en.Add.exchangeSave}));
    await waitFor(()=>expect(mocks.createTransfer).toHaveBeenCalledWith(expect.objectContaining({sourceBalanceId:containers[0].defaultBalanceId,destinationBalanceId:containers[0].balances[0].id,sentMinor:100000000,receivedMinor:250})));
    fireEvent.change(screen.getByRole("combobox",{name:en.Add.fromCurrency}),{target:{value:containers[0].balances[0].id}});
    expect(screen.getByLabelText(en.Add.amount).textContent).toContain("0");
    expect((screen.getByRole("button",{name:en.Add.exchangeSave}) as HTMLButtonElement).disabled).toBe(true);
    expect(containers[0].defaultBalanceId).toBe(codeId(911));
  });
  it("clears typed source and received drafts if runtime precision changes on refresh", () => {
    const state: ComposerState={mode:"add",draftId:codeId(999),preset:{kind:"exchange",walletId:containers[0].id}};
    const tree=(catalog:typeof definitions)=><NextIntlClientProvider locale="en" messages={en}><AppDataProvider walletContainers={containers} currencies={catalog} categories={[expenseCategory]} timezone="UTC" salary={null} usdLbpRate={null}><TransactionSheet state={state} onClose={vi.fn()}/></AppDataProvider></NextIntlClientProvider>;
    const view=render(tree(definitions));
    fireEvent.change(screen.getByRole("combobox",{name:en.Add.to}),{target:{value:containers[0].id}});
    fireEvent.click(screen.getByRole("button",{name:"1"}));
    fireEvent.click(screen.getByRole("button",{name:en.Add.editReceived}));
    fireEvent.change(input(en.Add.received.replace("{currency}","USD")),{target:{value:"2.50"}});
    view.rerender(tree(definitions.map(c=>c.code==="TOK"?{...c,decimalPlaces:3}:c)));
    expect(screen.getByLabelText(en.Add.amount).textContent).toBe("T0");
    expect(input(en.Add.received.replace("{currency}","USD")).value).toBe("");
    expect(input(en.Add.received.replace("{currency}","USD")).readOnly).toBe(true);
  });

  it("starts top-up Move from the other wallet's default, preserving the selected destination default", () => {
    canonical("income");
    fireEvent.click(screen.getByRole("radio",{name:en.Add.move}));
    expect((screen.getByRole("combobox",{name:en.Add.fromCurrency}) as HTMLSelectElement).value).toBe(containers[1].defaultBalanceId);
    expect((screen.getByRole("combobox",{name:en.Add.toCurrency}) as HTMLSelectElement).value).toBe(containers[0].defaultBalanceId);
  });

  function draftTree(wallets = containers, catalog = definitions) {
    return <NextIntlClientProvider locale="en" messages={en}>
      <AppDataProvider walletContainers={wallets} currencies={catalog} categories={[expenseCategory]} timezone="UTC" salary={null} usdLbpRate={null}>
        <TransactionSheet state={{ mode: "add", draftId: codeId(999), preset: { kind: "expense", walletId: containers[0].id, categoryId: expenseCategory.id } }} onClose={vi.fn()} />
      </AppDataProvider>
    </NextIntlClientProvider>;
  }
  function addItem() {
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    fireEvent.click(screen.getByRole("button", { name: en.Breakdown.title }));
    fireEvent.click(screen.getByRole("button", { name: en.Breakdown.addItem }));
    fireEvent.change(input(en.Breakdown.description), { target: { value: "Draft item" } });
    fireEvent.change(input(en.Breakdown.amount), { target: { value: "0.12345678" } });
  }
  function startCash() {
    fireEvent.click(screen.getByRole("radio", { name: en.Cashier.cashPurchase }));
    fireEvent.change(input(en.Cashier.tender), { target: { value: "1.23456789" } });
  }
  for (const reason of ["deleted", "needsAttention"] as const) {
    it(`discards payer tender and itemized cost permanently when its wallet becomes ${reason}`, () => {
      const view = render(draftTree());
      addItem();
      startCash();
      view.rerender(draftTree(containers.map((wallet, index) => index === 0 ? { ...wallet, [reason]: true } : wallet)));
      expect(input(en.Cashier.tender).value).toBe("");
      expect(screen.getByLabelText(en.Add.amount).textContent).toBe("T0");
      expect(screen.queryByLabelText(en.Breakdown.amount)).toBeNull();
      fireEvent.change(screen.getByRole("combobox", { name: en.Cashier.paidFrom }), { target: { value: containers[1].id } });
      expect(input(en.Cashier.tender).value).toBe("");
      view.rerender(draftTree());
      fireEvent.change(screen.getByRole("combobox", { name: en.Cashier.paidFrom }), { target: { value: containers[0].id } });
      expect(input(en.Cashier.tender).value).toBe("");
      expect(screen.queryByLabelText(en.Breakdown.amount)).toBeNull();
    });
    it(`discards only the unavailable return when its wallet becomes ${reason}`, () => {
      const view = render(draftTree());
      startCash();
      fireEvent.click(screen.getByRole("button", { name: en.Cashier.addChange }));
      fireEvent.change(input(en.Cashier.change), { target: { value: "0.11111111" } });
      fireEvent.click(screen.getByRole("button", { name: en.Cashier.addChange }));
      fireEvent.change(screen.getAllByRole("combobox", { name: en.Cashier.wallet })[1], { target: { value: containers[1].id } });
      fireEvent.change(screen.getAllByLabelText(en.Cashier.change)[1], { target: { value: "0.22222222" } });
      view.rerender(draftTree(containers.map((wallet, index) => index === 1 ? { ...wallet, [reason]: true } : wallet)));
      const values = () => screen.getAllByLabelText(en.Cashier.change).map((element) => (element as HTMLInputElement).value);
      expect(values()).toEqual(["0.11111111", ""]);
      expect(input(en.Cashier.tender).value).toBe("1.23456789");
      fireEvent.change(screen.getAllByRole("combobox", { name: en.Cashier.wallet })[1], { target: { value: containers[0].id } });
      expect(values()).toEqual(["0.11111111", ""]);
      view.rerender(draftTree());
      fireEvent.change(screen.getAllByRole("combobox", { name: en.Cashier.wallet })[1], { target: { value: containers[1].id } });
      expect(values()).toEqual(["0.11111111", ""]);
    });
    it(`discards standard expense source and item text through a ${reason} round trip`, () => {
      const view = render(draftTree());
      addItem();
      view.rerender(draftTree(containers.map((wallet, index) => index === 0 ? { ...wallet, [reason]: true } : wallet)));
      expect(screen.getByLabelText(en.Add.amount).textContent).toBe("T0");
      expect(screen.queryByLabelText(en.Breakdown.amount)).toBeNull();
      view.rerender(draftTree());
      expect(screen.getByLabelText(en.Add.amount).textContent).toBe("T0");
      fireEvent.click(screen.getByRole("button", { name: /Pocket TOK/ }));
      fireEvent.change(screen.getByRole("combobox", { name: en.Add.wallet }), { target: { value: containers[1].id } });
      expect(screen.getByLabelText(en.Add.amount).textContent).toBe("T0");
      expect(screen.queryByLabelText(en.Breakdown.amount)).toBeNull();
    });
  }
  it("retains cashier and item text on symbol refresh and when adding an independent return", () => {
    const view = render(draftTree());
    addItem();
    startCash();
    fireEvent.click(screen.getByRole("button", { name: en.Cashier.addChange }));
    fireEvent.change(input(en.Cashier.change), { target: { value: "0.12345678" } });
    view.rerender(draftTree(containers, definitions.map((currency) => ({ ...currency, symbol: "Token" }))));
    fireEvent.click(screen.getByRole("button", { name: en.Cashier.addChange }));
    expect(input(en.Cashier.tender).value).toBe("1.23456789");
    expect(screen.getAllByLabelText(en.Cashier.change).map((element) => (element as HTMLInputElement).value)).toEqual(["0.12345678", ""]);
    expect(input(en.Breakdown.amount).value).toBe("0.12345678");
    expect(input(en.Breakdown.description).value).toBe("Draft item");
    expect(screen.getByLabelText(en.Add.amount).textContent).toBe("Token1");
  });

});

it.each(["move", "exchange"] as const)("retains the exact %s attempt across a committed-response loss", async (kind) => {
  const t = mount("en", 89500, { mode: "add", draftId: "00000000-0000-4000-8000-000000000099", preset: { kind } });
  if (kind === "move") await choose(t.to, /Bank USD/);
  else {
    fireEvent.change(screen.getByRole("combobox", { name: t.to }), { target: { value: wallets[0].id } });
  }
  fireEvent.click(screen.getByRole("button", { name: "1" }));
  if (kind === "exchange") {
    fireEvent.click(screen.getByRole("button", { name: t.editReceived }));
    fireEvent.change(screen.getByLabelText(t.received.replace("{currency}", "LBP")), { target: { value: "90000" } });
  }
  mocks.createTransfer.mockRejectedValueOnce(new Error("Response lost after commit"));
  fireEvent.click(screen.getByRole("button", { name: kind === "move" ? t.moveSave : t.exchangeSave }));
  await waitFor(() => expect(screen.getByText(en.Breakdown.unknownOutcome)).toBeTruthy());
  const first = mocks.createTransfer.mock.calls[0][0];
  expect(first.requestId).toBe("00000000-0000-4000-8000-000000000099");
  expect(first.expectedUnits).toEqual(kind === "move" ? { USD: 2 } : { USD: 2, LBP: 0 });
  mocks.createTransfer.mockResolvedValueOnce({ ok: true, id: "00000000-0000-4000-8000-000000000099", revision: 1 });
  await waitFor(() => expect(screen.getByRole("button", { name: en.Breakdown.retrySave }).matches(":disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: en.Breakdown.retrySave }));
  await waitFor(() => expect(mocks.createTransfer).toHaveBeenCalledTimes(2));
  expect(mocks.createTransfer.mock.calls[1][0]).toEqual(first);
});

describe("unsaved entry survives an accidental dismiss", () => {
  const draftState: ComposerState = { mode: "add", draftId: "00000000-0000-4000-8000-000000000071", preset: { kind: "expense" } };
  const renderSheet = (state: ComposerState | null, props: Partial<React.ComponentProps<typeof TransactionSheet>> = {}) => (
    <NextIntlClientProvider locale="en" messages={en}>
      <AppDataProvider walletContainers={completeFixtureWallets(wallets)} currencies={[...SEED_CURRENCY_DEFINITIONS]} categories={[expenseCategory]} timezone="Asia/Beirut" salary={null} usdLbpRate={89500}>
        <TransactionSheet state={state} onClose={vi.fn()} {...props} />
      </AppDataProvider>
    </NextIntlClientProvider>
  );

  it("hands the typed amount to onStash on dismiss and restores it with a Start over option", () => {
    const onStash = vi.fn();
    const first = render(renderSheet(draftState, { onStash }));
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    first.rerender(renderSheet(null, { onStash }));
    expect(onStash).toHaveBeenCalledTimes(1);
    const draft = onStash.mock.calls[0][0];
    expect(draft.typed).toBe("42");
    first.unmount();

    const onStartOver = vi.fn();
    render(renderSheet({ ...draftState, draftId: "00000000-0000-4000-8000-000000000072", restore: draft }, { onStartOver }));
    expect(screen.getByText(en.Add.draftRestored)).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en.Add.startOver }));
    expect(onStartOver).toHaveBeenCalledTimes(1);
  });

  it("stashes nothing for an untouched form, and nothing after Start over", () => {
    const onStash = vi.fn();
    const untouched = render(renderSheet(draftState, { onStash }));
    untouched.rerender(renderSheet(null, { onStash }));
    expect(onStash).not.toHaveBeenCalled();
    untouched.unmount();

    const restoreState: ComposerState = {
      ...draftState, draftId: "00000000-0000-4000-8000-000000000073",
      restore: { mode: "expense", balanceId: wallets[0].id, toBalanceId: "", purchaseCurrency: "USD",
        cashDraft: { enabled: false, tenderText: "", changes: [] }, typed: "7", rateText: "", receivedText: "",
        receivedEdited: false, categoryId: "", date: "2026-11-06", note: "", itemDrafts: [], details: false },
    };
    const restored = render(renderSheet(restoreState, { onStash, onStartOver: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: en.Add.startOver }));
    restored.rerender(renderSheet(null, { onStash }));
    expect(onStash).not.toHaveBeenCalled();
  });
});
