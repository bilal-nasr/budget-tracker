// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CashSettlementFields, parseSettlementDraft, type CashSettlementLabels, type CashSettlementDraft } from "./cash-settlement-fields";
afterEach(cleanup);
const usd = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Cash", currency: "USD" as const, archived: false };
const lbp = { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "ليرة", currency: "LBP" as const, archived: false };
const draft: CashSettlementDraft = { enabled: true, tenderText: "20", changeText: "671250", changeCurrency: "LBP", changeWalletId: lbp.id, rateText: "89500", rateConfirmed: true };
const editContext = { walletId: usd.id, original: { walletId: usd.id, currency: usd.currency, amountMinor: 1250,
  settlement: { tenderMinor: 2000, change: { walletId: lbp.id, amountMinor: 671250, currency: lbp.currency,
    rate: { base: "USD" as const, quote: "LBP" as const, quoteMajorNumerator: 89500, quoteMajorDenominator: 1 } } },
} };
const labels: CashSettlementLabels = {
  title: "Cash paid and change", tender: "Paid to cashier", change: "Change received", currency: "Change currency", wallet: "Put change in", rate: "Confirmed transaction rate", confirmRate: "Use this rate for this purchase", createWallet: "Create wallet", selectWallet: "Choose a wallet", noChange: "No change", needWallet: (c) => `Create an active ${c} wallet to receive change.`,
  errors: { amount: "Enter valid amounts.", rate: "Confirm a valid rate.", mismatch: "Cost, paid and change do not match.", unsupportedPair: "Unsupported pair.", walletUnavailable: "Choose an active wallet." },
};
describe("cash settlement fields", () => {
  it("retains the archived original receiver for metadata-only edits, but never for new or changed money", () => {
    const archivedWallets = [usd, { ...lbp, archived: true }];
    expect(parseSettlementDraft(draft, "USD", 1250, archivedWallets, editContext).ok).toBe(true);
    expect(parseSettlementDraft(draft, "USD", 1250, archivedWallets)).toEqual({ ok: false, error: "walletUnavailable" });
    expect(parseSettlementDraft({ ...draft, tenderText: "21" }, "USD", 1350, archivedWallets, editContext)).toEqual({ ok: false, error: "walletUnavailable" });
    expect(parseSettlementDraft(draft, "USD", 1250, archivedWallets, { ...editContext, walletId: "another-paying-wallet" })).toEqual({ ok: false, error: "walletUnavailable" });
    expect(parseSettlementDraft({ ...draft, rateText: "90000" }, "USD", 1254, archivedWallets, editContext).ok).toBe(false);
  });
  it("keeps the archived original wallet selected and visible in the edit picker", () => {
    render(<CashSettlementFields draft={draft} payCurrency="USD" costMinor={1250} wallets={[usd, { ...lbp, archived: true }]} editContext={editContext}
      labels={labels} onChange={vi.fn()} onCreateWallet={vi.fn()} />);
    const select = screen.getByLabelText(labels.wallet) as HTMLSelectElement;
    expect(select.value).toBe(lbp.id);
    expect(screen.getByRole("option", { name: "ليرة · LBP" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("parses an actual-cash draft, requires confirmation and an active receiver", () => {
    expect(parseSettlementDraft(draft, usd.currency, 1250, [usd, lbp]).ok).toBe(true);
    expect(parseSettlementDraft({ ...draft, rateConfirmed: false }, usd.currency, 1250, [usd, lbp])).toEqual({ ok: false, error: "rate" });
    expect(parseSettlementDraft(draft, usd.currency, 1250, [usd, { ...lbp, archived: true }])).toEqual({ ok: false, error: "walletUnavailable" });
    expect(parseSettlementDraft({ ...draft, enabled: false }, usd.currency, 1250, [])).toEqual({ ok: true, settlement: null });
  });
  it("keeps the ordinary expense collapsed and emits controlled changes", () => {
    const onChange = vi.fn();
    render(<CashSettlementFields draft={{ ...draft, enabled: false }} payCurrency="USD" costMinor={1250} wallets={[usd, lbp]} labels={labels} onChange={onChange} onCreateWallet={vi.fn()} />);
    expect(screen.queryByLabelText(labels.tender)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: labels.title }));
    expect(onChange.mock.calls[0][0].enabled).toBe(true);
  });
  it("explains disabled currencies without an active wallet", () => {
    const create = vi.fn();
    render(<CashSettlementFields draft={draft} payCurrency="USD" costMinor={1250} wallets={[usd, { ...lbp, archived: true }]} labels={labels} onChange={vi.fn()} onCreateWallet={create} />);
    expect((screen.getByRole("option", { name: "LBP" }) as HTMLOptionElement).disabled).toBe(true);
    expect(screen.getByText(labels.needWallet("LBP"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: labels.createWallet }));
    expect(create).toHaveBeenCalledOnce();
  });
  it("explains unavailable currencies even before they are selected", () => {
    render(<CashSettlementFields draft={{ ...draft, changeCurrency: "USD", changeWalletId: usd.id, changeText: "7.50" }} payCurrency="USD" costMinor={1250} wallets={[usd]} labels={labels} onChange={vi.fn()} onCreateWallet={vi.fn()} />);
    expect(screen.getByText(labels.needWallet("LBP"))).toBeTruthy();
  });
  it("invalidates receiving amount and confirmation on currency changes", () => {
    const onChange = vi.fn();
    render(<CashSettlementFields draft={draft} payCurrency="USD" costMinor={1250} wallets={[usd, lbp]} labels={labels} onChange={onChange} onCreateWallet={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(labels.currency), { target: { value: "USD" } });
    expect(onChange.mock.calls[0][0]).toMatchObject({ changeCurrency: "USD", changeText: "", changeWalletId: usd.id, rateConfirmed: false, rateText: "" });
  });
  it("uses LTR text money fields inside Arabic context and rejects discrepancies", () => {
    render(<div dir="rtl"><CashSettlementFields draft={{ ...draft, tenderText: "21" }} payCurrency="USD" costMinor={1250} wallets={[usd, lbp]} labels={{ ...labels, tender: "المبلغ المدفوع" }} onChange={vi.fn()} onCreateWallet={vi.fn()} /></div>);
    const input = screen.getByLabelText("المبلغ المدفوع");
    expect(input.getAttribute("dir")).toBe("ltr");
    expect(input.getAttribute("type")).toBe("text");
    expect(screen.getByRole("alert").textContent).toBe(labels.errors.mismatch);
  });
});
