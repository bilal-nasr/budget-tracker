// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { AppDataProvider } from "@/components/providers/app-data";
import type { Wallet } from "@/features/wallets/schema";

const mocks = vi.hoisted(() => ({ createTransfer: vi.fn(), createTransaction: vi.fn(), deleteTransaction: vi.fn(), updateTransaction: vi.fn(), push: vi.fn() }));
vi.mock("@/features/transactions/actions", () => mocks);
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/components/ui/sheet-shell", () => ({ SheetShell: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));
import { TransactionSheet } from "./transaction-sheet";

const wallet = (n: number, name: string, currency: Wallet["currency"]): Wallet => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, name, currency,
  kind: "cash", position: n, openingBalanceMinor: 0, balanceMinor: 100000, archived: false,
});
const wallets = [wallet(1, "Cash", "USD"), wallet(2, "Bank", "USD"), wallet(3, "Cash", "LBP"), wallet(6, "Syrian cash", "SYP"), wallet(7, "Syrian bank", "SYP")];
function mount(locale: "en" | "ar" = "en", rate: number | null = 89500) {
  const messages = locale === "en" ? en : ar;
  render(<NextIntlClientProvider locale={locale} messages={messages}>
    <AppDataProvider wallets={wallets} categories={[]} timezone="Asia/Beirut" salary={null} usdLbpRate={rate}>
      <TransactionSheet state={{ mode: "add", draftId: "00000000-0000-4000-8000-000000000099", preset: { kind: "move" } }} onClose={vi.fn()} />
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
    fireEvent.change(received, { target: { value: "١٢٫٥٠" } });
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
