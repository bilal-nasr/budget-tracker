// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { AppDataProvider } from "@/components/providers/app-data";
import { emptyTransactionMetadata, type Transaction } from "@/features/transactions/schema";
import type { Wallet } from "@/features/wallets/schema";

const mocks = vi.hoisted(() => ({ createTransfer: vi.fn(), createTransaction: vi.fn(), deleteTransaction: vi.fn(), updateTransaction: vi.fn(), push: vi.fn() }));
vi.mock("@/features/transactions/actions", () => mocks);
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/components/ui/sheet-shell", () => ({ SheetShell: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));
import { TransactionSheet } from "./transaction-sheet";

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
const editedTransaction: Transaction = {
  ...emptyTransactionMetadata(),
  id: "00000000-0000-4000-8000-000000000098",
  kind: "expense",
  occurredOn: "2026-11-05",
  amountMinor: 100,
  currency: "USD",
  walletId: wallets[0].id,
  categoryId: null,
  toWalletId: null,
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
    <AppDataProvider wallets={wallets} categories={[]} timezone="Asia/Beirut" salary={null} usdLbpRate={rate}>
      <TransactionSheet state={state} onClose={vi.fn()} />
    </AppDataProvider>
  </NextIntlClientProvider>);
  return messages.Add;
}
async function choose(label: string, option: RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: new RegExp(`^${label}`) }));
  const item = await screen.findByRole("option", { name: option });
  fireEvent.pointerDown(item, { pointerType: "mouse", button: 0 });
  fireEvent.click(item, { detail: 1, button: 0 });
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
    fireEvent.click(screen.getByRole("radio", { name: /Bank/ }));
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
    await waitFor(() => expect(mocks.createTransfer).toHaveBeenCalledWith(expect.objectContaining({ toAmountMinor: 1250, rate: undefined })));
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
