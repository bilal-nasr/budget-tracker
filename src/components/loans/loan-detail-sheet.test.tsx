// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { demoLoans } from "@/lib/demo-data";

const state = vi.hoisted(() => ({ load: vi.fn(), voidPayment: vi.fn(), deleteLoan: vi.fn(), deletePayment: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/loans/history-actions", () => ({ loadLoanHistory: state.load }));
vi.mock("@/features/loans/actions", () => ({ cancelLoan: vi.fn(), restoreLoanPayment: vi.fn(), setLoanArchived: vi.fn(), voidLoanPayment: state.voidPayment, deleteLoan: state.deleteLoan, deleteLoanPayment: state.deletePayment }));
vi.mock("@/components/ui/sheet-shell", () => ({ SheetShell: ({ open, children, footer }: { open: boolean; children: ReactNode; footer?: ReactNode }) => open ? <section>{children}{footer}</section> : null }));
vi.mock("@/components/providers/app-data", () => ({ useAppData: () => ({ walletById: () => ({ name: "Synthetic wallet" }) }) }));
import { LoanDetailSheet } from "./loan-detail-sheet";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it.each(["en", "ar"] as const)("only offers permanent loan deletion after archive and confirms before deleting (%s)", async (locale) => {
  const messages = locale === "ar" ? ar : en;
  const onClose = vi.fn();
  const base = { ...demoLoans()[0], events: [], historyComplete: true };
  const view = render(<NextIntlClientProvider locale={locale} messages={messages}><LoanDetailSheet item={base} onClose={onClose} onEdit={vi.fn()} onPay={vi.fn()} /></NextIntlClientProvider>);
  expect(screen.queryByRole("button", { name: messages.Loans.deleteLoan })).toBeNull();
  view.rerender(<NextIntlClientProvider locale={locale} messages={messages}><LoanDetailSheet item={{ ...base, remainingMinor: 0, archivedAt: "2026-11-04T00:00:00Z" }} onClose={onClose} onEdit={vi.fn()} onPay={vi.fn()} /></NextIntlClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: messages.Loans.deleteLoan }));
  expect(state.deleteLoan).not.toHaveBeenCalled();
  expect(screen.getByText(messages.Loans.deleteLoanHelp)).toBeTruthy();
  state.deleteLoan.mockResolvedValue({ ok: true });
  fireEvent.click(screen.getAllByRole("button", { name: messages.Loans.deleteLoan }).at(-1)!);
  await waitFor(() => expect(state.deleteLoan).toHaveBeenCalledWith(base.id));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it.each(["en", "ar"] as const)("allows permanent deletion of a canceled unarchived loan (%s)", async (locale) => {
  const messages = locale === "ar" ? ar : en;
  const item = { ...demoLoans()[0], events: [], historyComplete: true, archivedAt: null, deletedAt: "2026-11-04T00:00:00Z" };
  const onClose = vi.fn();
  state.deleteLoan.mockResolvedValue({ ok: true });
  render(<NextIntlClientProvider locale={locale} messages={messages}><LoanDetailSheet item={item} onClose={onClose} onEdit={vi.fn()} onPay={vi.fn()} /></NextIntlClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: messages.Loans.deleteLoan }));
  expect(state.deleteLoan).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: messages.Loans.deleteLoan }).at(-1)!);
  await waitFor(() => expect(state.deleteLoan).toHaveBeenCalledWith(item.id));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it("allows permanently deleting an older payment with its revision and keeps failures visible", async () => {
  const base = demoLoans()[0];
  const old = { transactionId: "old", revision: 4, loanId: base.id, event: "repayment" as const, flow: "out" as const,
    sequence: 1, walletId: base.walletId, occurredOn: "2026-01-02", amountMinor: 100, principalMinor: 100, feeMinor: 0,
    categoryId: base.feeCategoryId, deletedAt: null };
  const onClose = vi.fn();
  const item = { ...base, events: [old], historyComplete: true, livePaymentCount: 40,
    latestLivePayment: { transactionId: "latest", revision: 7, sequence: 42 } };
  state.deletePayment.mockResolvedValue({ ok: false, error: "conflict" });
  render(<NextIntlClientProvider locale="en" messages={en}><LoanDetailSheet item={item} onClose={onClose} onEdit={vi.fn()} onPay={vi.fn()} /></NextIntlClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Delete payment" }));
  expect(state.deletePayment).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "Delete payment" }).at(-1)!);
  await waitFor(() => expect(state.deletePayment).toHaveBeenCalledWith("old", 4));
  expect(onClose).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getAllByRole("alert").some((node) => node.textContent === en.Loans.errorConflict)).toBe(true));
});

it("keeps Cancel and older Restore unavailable when newer live payments are outside the loaded history page", async () => {
  const base = demoLoans()[0];
  const old = { transactionId: "old", revision: 4, loanId: base.id, event: "repayment" as const, flow: "out" as const,
    sequence: 1, walletId: base.walletId, occurredOn: "2026-01-02", amountMinor: 100, principalMinor: 100, feeMinor: 0,
    categoryId: base.feeCategoryId, deletedAt: "2026-01-03T00:00:00Z" };
  state.load.mockResolvedValue({ rows: [old], next: 1 });
  const item = { ...base, events: [], historyComplete: false, livePaymentCount: 40,
    latestLivePayment: { transactionId: "latest", revision: 7, sequence: 42 }, latestPaymentOn: "2026-11-02" };
  state.voidPayment.mockResolvedValue({ ok: false, error: "conflict" });
  render(<NextIntlClientProvider locale="en" messages={en}><LoanDetailSheet item={item} onClose={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} /></NextIntlClientProvider>);
  await waitFor(() => expect(screen.getByText(new RegExp(en.Loans.voided))).toBeTruthy());
  expect(screen.queryByRole("button", { name: en.Loans.cancelLoan })).toBeNull();
  expect(screen.queryByRole("button", { name: en.Loans.restore })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: en.Loans.void }));
  const buttons = screen.getAllByRole("button", { name: en.Loans.void });
  fireEvent.click(buttons.at(-1)!);
  await waitFor(() => expect(state.voidPayment).toHaveBeenCalledWith("latest", 7));
});

it("shows a history failure with a retry instead of presenting an empty history", async () => {
  state.load.mockRejectedValue(new Error("synthetic failure"));
  const item = { ...demoLoans()[0], events: [], historyComplete: false, livePaymentCount: 1,
    latestLivePayment: { transactionId: "latest", revision: 1, sequence: 1 } };
  render(<NextIntlClientProvider locale="en" messages={en}><LoanDetailSheet item={item} onClose={vi.fn()} onEdit={vi.fn()} onPay={vi.fn()} /></NextIntlClientProvider>);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(en.Activity.loadFailed));
  expect(screen.queryByText(en.Loans.noHistory)).toBeNull();
  expect(screen.getByRole("button", { name: en.Activity.loadMore })).toBeTruthy();
});
