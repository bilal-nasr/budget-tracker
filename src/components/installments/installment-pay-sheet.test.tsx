// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import messages from "@/messages/en.json";
import { withProgress } from "@/features/installments/cycle";

const mocks = vi.hoisted(() => ({ pay: vi.fn(), remove: vi.fn(), close: vi.fn(), refresh: vi.fn(), appData: vi.fn(), toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/features/installments/actions", () => ({ payInstallment: mocks.pay }));
vi.mock("@/features/transactions/actions", () => ({ deleteTransaction: mocks.remove }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/components/providers/display-prefs", () => ({ useDisplayPrefs: () => ({ digits: "latin" }) }));
vi.mock("@/components/providers/app-data", () => ({ useAppData: () => mocks.appData() }));
vi.mock("@/components/ui/sheet-shell", () => ({ SheetShell: ({ open, title, children }: { open: boolean; title: string; children: ReactNode }) => open ? <div role="dialog" aria-label={title}>{children}</div> : null }));
vi.mock("@/components/ui/confirm-sheet", () => ({ ConfirmSheet: ({ open, title, children, onConfirm, onOpenChange }: {
  open: boolean; title: string; children: ReactNode; onConfirm: () => void; onOpenChange: (open: boolean) => void;
}) => open ? <div role="dialog" aria-label={title}>{children}<button type="button" onClick={onConfirm}>Confirm extra payment</button><button type="button" onClick={() => onOpenChange(false)}>Cancel extra payment</button></div> : null }));
import { InstallmentPaySheet } from "./installment-pay-sheet";

const itemId = "a1000000-0000-4000-8000-000000000001";
const walletId = "a2000000-0000-4000-8000-000000000001";
const cycleId = "a3000000-0000-4000-8000-000000000001";
const requestId = "a4000000-0000-4000-8000-000000000001";
const previousId = "a5000000-0000-4000-8000-000000000001";
const base = { id: itemId, name: "Laptop", currency: "USD" as const, walletId, categoryId: itemId,
  totalMinor: 120000, paidBeforeMinor: 20000, monthlyMinor: 10000, dueDay: 15 };
const partial = withProgress(base, [{ transactionId: previousId, walletId, amountMinor: 4000, occurredOn: "2026-10-01",
  createdAt: "2026-11-04T12:00:00Z", salaryCycleId: cycleId, revision: 1 }], cycleId);
const bank = { id: walletId, name: "Bank", currency: "USD", archived: false };
beforeEach(() => { vi.clearAllMocks(); mocks.pay.mockResolvedValue({ ok: false, error: "notConfigured" }); mocks.remove.mockResolvedValue({ ok: true, id: requestId, revision: 4 });
  mocks.appData.mockReturnValue({timezone:"Asia/Beirut",wallets:[bank]});
});
afterEach(cleanup);
const view = (intent: "normal" | "again" = "again") => <NextIntlClientProvider locale="en" messages={messages}>
  <InstallmentPaySheet state={{ item: intent === "again" ? partial : withProgress(base, [], cycleId), intent, requestId }} onClose={mocks.close} />
</NextIntlClientProvider>;
const show = (intent: "normal" | "again" = "again") => render(view(intent));

it("requires deliberate confirmation for another payment, and cancel writes nothing", async () => {
  show();
  expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("60");
  fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
  expect(mocks.pay).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel extra payment" }));
  expect(mocks.pay).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm extra payment" }));
  await waitFor(() => expect(mocks.pay).toHaveBeenCalledOnce());
  expect(mocks.pay.mock.calls[0][0]).toMatchObject({ requestId, installmentId: itemId, walletId, amountMinor: 6000,
    salaryCycleId: cycleId, overrideOfTransactionId: previousId });
});

it("freezes an unknown-outcome intent and retries with identical fields/request identity", async () => {
  mocks.pay.mockResolvedValueOnce({ ok: false, error: "failed" });
  show("normal");
  fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect((screen.getByLabelText("Amount") as HTMLInputElement).matches(":disabled")).toBe(true);
  const first = mocks.pay.mock.calls[0][0];
  fireEvent.click(await screen.findByRole("button", { name: /Retry same payment/ }));
  await waitFor(() => expect(mocks.pay).toHaveBeenCalledTimes(2));
  expect(mocks.pay.mock.calls[1][0]).toEqual(first);
});

it("preserves the actual creation revision for Undo instead of fetching a newer token", async () => {
  mocks.pay.mockResolvedValue({ ok: true, id: requestId, revision: 3 });
  show("normal");
  fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
  await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
  await mocks.toast.mock.calls[0][1].action.onClick();
  expect(mocks.remove).toHaveBeenCalledWith(requestId, 3);
});

it.each(["archived","removed","other currency"])("keeps the frozen payment retry when the provider has no usable wallet: %s",async(change)=>{
  mocks.pay.mockResolvedValueOnce({ok:false,error:"failed"});
  const rendered=show("normal");
  fireEvent.click(screen.getByRole("button",{name:"Record payment"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Retry same payment"})).toBeTruthy());
  const first=mocks.pay.mock.calls[0][0];
  mocks.appData.mockReturnValue({timezone:"Asia/Beirut",wallets:change==="removed"?[]:
    [{...bank,archived:change==="archived",currency:change==="other currency"?"LBP":"USD"}]});
  rendered.rerender(view("normal"));
  expect(screen.queryByText(messages.Installments.noWalletForCurrency)).toBeNull();
  expect((screen.getByLabelText("Amount") as HTMLInputElement).matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Retry same payment"}));
  await waitFor(()=>expect(mocks.pay).toHaveBeenCalledTimes(2));
  expect(mocks.pay.mock.calls[1][0]).toEqual(first);
});
