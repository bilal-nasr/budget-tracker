import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { AppDataProvider } from "@/components/providers/app-data";
import { DEMO_WALLET_CONTAINERS, DEMO_CATEGORIES } from "@/lib/demo-data";
import en from "@/messages/en.json";
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import ar from "@/messages/ar.json";
vi.mock("server-only", () => ({}));

const mock = vi.hoisted(() => ({ createFixedExpense: vi.fn(), updateFixedExpense: vi.fn(), deleteFixedExpense: vi.fn(), close: vi.fn() }));
vi.mock("@/features/fixed/actions", () => mock);
vi.mock("@/features/installments/actions", () => ({ createInstallment: vi.fn(), updateInstallment: vi.fn(), deleteInstallment: vi.fn() }));
vi.mock("@/components/ui/sheet-shell", () => ({ SheetShell: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null }));
import { FixedSheet } from "./fixed-sheet";

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe.each(["en", "ar"] as const)("%s fixed breakdown", (locale) => {
  it("hydrates saved lines, prevents excess and currency changes, and submits edits", async () => {
    const messages = locale === "en" ? en : ar;
    const wallets = DEMO_WALLET_CONTAINERS;
    const wallet = wallets[0];
    const other = wallets.find((w) => w.name === "Syrian cash")!;
    const category = DEMO_CATEGORIES.find((c) => c.kind === "expense")!;
    const id = "00000000-0000-4000-8000-000000000099";
    mock.updateFixedExpense.mockResolvedValue({ ok: true });
    render(<NextIntlClientProvider locale={locale} messages={messages}>
      <AppDataProvider walletContainers={wallets} currencies={[...SEED_CURRENCY_DEFINITIONS]} categories={DEMO_CATEGORIES} timezone="Asia/Beirut" salary={null} usdLbpRate={89500}>
        <FixedSheet state={{ item: { id, name: "Household", balanceId: wallet.id, categoryId: category.id,
          amountMinor: 5000, dueDay: null, paidOn: null, items: [{ description: "Internet", amountMinor: 2000 }] } }} onClose={mock.close} />
      </AppDataProvider>
    </NextIntlClientProvider>);
    expect((screen.getByLabelText(messages.Breakdown.description) as HTMLInputElement).value).toBe("Internet");
    fireEvent.change(screen.getByLabelText(messages.Fixed.wallet), { target: { value: other.id } });
    expect((screen.getByLabelText(messages.Fixed.wallet) as HTMLSelectElement).value).toBe(wallet.id);
    expect(screen.getByRole("alert").textContent).toBe(messages.Breakdown.removeBeforeCurrencyChange);
    fireEvent.change(screen.getByLabelText(messages.Breakdown.amount), { target: { value: "50.01" } });
    expect((screen.getByRole("button", { name: messages.Fixed.saveChanges }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(messages.Breakdown.amount), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: messages.Fixed.saveChanges }));
    await waitFor(() => expect(mock.updateFixedExpense).toHaveBeenCalledWith(id, expect.objectContaining({
      amountMinor: 5000, items: [{ description: "Internet", amountMinor: 3000 }],
    })));
    await waitFor(() => expect(mock.close).toHaveBeenCalled());
  });
});
