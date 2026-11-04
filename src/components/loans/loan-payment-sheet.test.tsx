// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import type { Loan } from "@/features/loans/schema";
const action = vi.hoisted(() => vi.fn());
const model = vi.hoisted(() => ({ wallets: [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "USD wallet", currency: "USD", archived: false },
  { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "LBP wallet", currency: "LBP", archived: false },
] }));
vi.mock("@/features/loans/actions", () => ({ recordLoanPayment: action, voidLoanPayment: vi.fn() }));
vi.mock("@/components/ui/sheet-shell", () => ({ SheetShell: ({ children, footer, onOpenChange }: { children: ReactNode; footer: ReactNode; onOpenChange: (open: boolean) => void }) => <section><button onClick={() => onOpenChange(false)}>Dismiss</button>{children}{footer}</section> }));
vi.mock("@/components/providers/app-data", () => ({ useAppData: () => ({ timezone: "Asia/Beirut", wallets: model.wallets }) }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { LoanPaymentSheet } from "./loan-payment-sheet";
const item: Loan = {
  id: "aaaaaaaa-0000-4000-8000-000000000003", name: "Synthetic", direction: "borrowed", currency: "USD", walletId: "aaaaaaaa-0000-4000-8000-000000000001",
  feeCategoryId: "aaaaaaaa-0000-4000-8000-000000000004", openedOn: "2026-01-01", creationMode: "existing", principalMinor: 10000, feeBps: 500, feeMinor: 500,
  totalDueMinor: 10500, principalPaidBeforeMinor: 0, feePaidBeforeMinor: 0, principalPaidMinor: 0, feePaidMinor: 0,
  principalRemainingMinor: 10000, feeRemainingMinor: 500, remainingMinor: 10500, archivedAt: null, deletedAt: null, events: [],
};
beforeEach(() => { model.wallets = [{ id: item.walletId, name: "USD wallet", currency: "USD", archived: false }, { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "LBP wallet", currency: "LBP", archived: false }]; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("shows only same-currency wallets and rejects overpaying before a write", () => {
  render(<NextIntlClientProvider locale="en" messages={{ Loans: en.Loans }}><LoanPaymentSheet item={item} onClose={vi.fn()} /></NextIntlClientProvider>);
  expect(screen.queryByText("LBP wallet")).toBeNull();
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "105.01" } });
  expect(screen.getByRole("button", { name: "Record payment" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("This exceeds the remaining balance.")).toBeTruthy();
  expect(action).not.toHaveBeenCalled();
});
it("preserves Arabic numeric input, previews the split, and reports preview failure", async () => {
  action.mockResolvedValue({ ok: false, error: "notConfigured" });
  render(<NextIntlClientProvider locale="ar" messages={{ Loans: ar.Loans }}><LoanPaymentSheet item={item} onClose={vi.fn()} /></NextIntlClientProvider>);
  const input = screen.getByLabelText("المبلغ");
  fireEvent.change(input, { target: { value: "١٠٢٫٥٠" } });
  expect((input as HTMLInputElement).value).toBe("١٠٢٫٥٠");
  fireEvent.click(screen.getByRole("button", { name: "تسجيل الدفعة" }));
  await waitFor(() => expect(screen.getByText(ar.Loans.errorPreview)).toBeTruthy());
  expect(action.mock.calls[0][0].amountMinor).toBe(10250);
});
it.each(["failed", "throw"])("retains the exact %s attempt and keeps Retry reachable after refreshed balances/catalog disappear", async (outcome) => {
  if (outcome === "throw") action.mockRejectedValueOnce(new Error("response lost"));
  else action.mockResolvedValueOnce({ ok: false, error: "failed" });
  action.mockResolvedValueOnce({ ok: true, id: "aaaaaaaa-0000-4000-8000-000000000010", revision: 1 });
  const close = vi.fn();
  const renderSheet = (loan: Loan) => <NextIntlClientProvider locale="en" messages={{ Loans: en.Loans }}><LoanPaymentSheet item={loan} onClose={close} /></NextIntlClientProvider>;
  const view = render(renderSheet(item));
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "50" } });
  fireEvent.click(screen.getByRole("button", { name: en.Loans.recordPayment }));
  await waitFor(() => expect(screen.getByText(en.Loans.errorUncertain)).toBeTruthy());
  const original = action.mock.calls[0][0];
  expect(screen.getByLabelText("Amount").matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(close).not.toHaveBeenCalled();
  model.wallets = [];
  view.rerender(renderSheet({ ...item, remainingMinor: 0, principalRemainingMinor: 0, feeRemainingMinor: 0 }));
  const retry = screen.getByRole("button", { name: en.Loans.retrySame });
  expect(retry.hasAttribute("disabled")).toBe(false);
  fireEvent.click(retry);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(action.mock.calls[1][0]).toEqual(original);
});
it("blocks dismissal and duplicate submission while a response is pending", async () => {
  let complete!: (value: { ok: false; error: string }) => void;
  action.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const close = vi.fn();
  render(<NextIntlClientProvider locale="en" messages={{ Loans: en.Loans }}><LoanPaymentSheet item={item} onClose={close} /></NextIntlClientProvider>);
  const save = screen.getByRole("button", { name: en.Loans.recordPayment });
  fireEvent.click(save);
  fireEvent.submit(screen.getByLabelText("Amount").closest("form")!);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(action).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  complete({ ok: false, error: "notConfigured" });
  await waitFor(() => expect(screen.getByText(en.Loans.errorPreview)).toBeTruthy());
});
