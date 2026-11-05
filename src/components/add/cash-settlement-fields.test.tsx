// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CashSettlementFields,
  parseSettlementDraft,
  settlementDraftFromSnapshot,
  type CashSettlementDraft,
  type CashSettlementLabels,
} from "./cash-settlement-fields";

afterEach(cleanup);

const usd = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Cash", currency: "USD" as const, archived: false };
const lbp = { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "ليرة", currency: "LBP" as const, archived: false };
const historicalRate = {
  base: "USD" as const,
  quote: "LBP" as const,
  quoteMajorNumerator: 89500,
  quoteMajorDenominator: 1,
};
const draft: CashSettlementDraft = {
  enabled: true,
  tenderText: "20",
  changes: [
    { key: "usd-change", amountText: "5", currency: "USD", walletId: usd.id },
    { key: "lbp-change", amountText: "223750", currency: "LBP", walletId: lbp.id },
  ],
};
const editContext = {
  walletId: usd.id,
  original: {
    walletId: usd.id,
    currency: usd.currency,
    amountMinor: 1250,
    settlement: {
      tenderMinor: 2000,
      tenderCurrency: "USD" as const,
      changes: [
        { walletId: usd.id, amountMinor: 500, currency: usd.currency },
        { walletId: lbp.id, amountMinor: 223750, currency: lbp.currency, rate: historicalRate },
      ],
    },
  },
};
const labels: CashSettlementLabels = {
  title: "Cash paid and change",
  paidFrom: "Paid from wallet",
  tender: "Paid to cashier",
  change: "Change received",
  currency: "Change currency",
  wallet: "Put change in",
  addChange: "Add another change",
  removeChange: "Remove change",
  selectWallet: "Choose a wallet",
  errors: {
    amount: "Enter valid amounts.",
    rate: "Saved rate is invalid.",
    mismatch: "Cost, paid and change do not match.",
    unsupportedPair: "Unsupported pair.",
    walletUnavailable: "Choose an active wallet.",
  },
};

describe("cash settlement fields", () => {
  it("parses $20 paid with $5 and LBP returned as two exact change legs without a rate", () => {
    expect(parseSettlementDraft(draft, "USD", "USD", 1250, [usd, lbp])).toEqual({
      ok: true,
      settlement: {
        tenderMinor: 2000,
        changes: [
          { walletId: usd.id, amountMinor: 500 },
          { walletId: lbp.id, amountMinor: 223750 },
        ],
      },
    });
    expect(parseSettlementDraft({ ...draft, enabled: false }, "USD", "USD", 1250, [])).toEqual({ ok: true, settlement: null });
  });

  it("hydrates every saved change and drops historical rates only when duplicating", () => {
    const snapshot = editContext.original.settlement;
    const editing = settlementDraftFromSnapshot(snapshot, "USD", usd.id);
    expect(editing.changes).toHaveLength(2);
    expect(editing.changes[1]).toMatchObject({ amountText: "223750", currency: "LBP", walletId: lbp.id, rate: historicalRate });
    expect(settlementDraftFromSnapshot(snapshot, "USD", usd.id, true).changes[1].rate).toBeUndefined();
  });

  it("retains archived original receivers only for an exact financial edit", () => {
    const archivedWallets = [{ ...usd, archived: true }, { ...lbp, archived: true }];
    const historicalDraft = settlementDraftFromSnapshot(editContext.original.settlement, "USD", usd.id);
    expect(parseSettlementDraft(historicalDraft, "USD", "USD", 1250, archivedWallets, editContext).ok).toBe(true);
    expect(parseSettlementDraft(historicalDraft, "USD", "USD", 1250, archivedWallets)).toEqual({ ok: false, error: "walletUnavailable" });
    expect(parseSettlementDraft({ ...historicalDraft, tenderText: "21" }, "USD", "USD", 1250, archivedWallets, editContext))
      .toEqual({ ok: false, error: "walletUnavailable" });
    expect(parseSettlementDraft(historicalDraft, "USD", "USD", 1250, archivedWallets, { ...editContext, walletId: "another-paying-wallet" }))
      .toEqual({ ok: false, error: "walletUnavailable" });
  });

  it("renders both saved returns and keeps archived original receivers visible", () => {
    const historicalDraft = settlementDraftFromSnapshot(editContext.original.settlement, "USD", usd.id);
    render(<CashSettlementFields draft={historicalDraft} payCurrency="USD" costCurrency="USD" costMinor={1250}
      wallets={[{ ...usd, archived: true }, { ...lbp, archived: true }]} editContext={editContext}
      labels={labels} onChange={vi.fn()} />);
    expect(screen.getAllByLabelText(labels.change).map((input) => (input as HTMLInputElement).value)).toEqual(["5", "223750"]);
    expect(screen.getAllByLabelText(labels.wallet).map((select) => (select as HTMLSelectElement).value)).toEqual([usd.id, lbp.id]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: labels.title })).toBeNull();
  });

  it("adds and removes independent change rows", () => {
    const onChange = vi.fn();
    render(<CashSettlementFields draft={draft} payCurrency="USD" costCurrency="USD" costMinor={1250} wallets={[usd, lbp]}
      labels={labels} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: labels.addChange }));
    expect(onChange.mock.calls[0][0].changes).toHaveLength(3);
    fireEvent.click(screen.getAllByRole("button", { name: labels.removeChange })[0]);
    expect(onChange.mock.calls[1][0].changes).toEqual([draft.changes[1]]);
  });

  it("resets only the changed row when its currency changes", () => {
    const onChange = vi.fn();
    render(<CashSettlementFields draft={draft} payCurrency="USD" costCurrency="USD" costMinor={1250} wallets={[usd, lbp]}
      labels={labels} onChange={onChange} />);
    fireEvent.change(screen.getAllByLabelText(labels.currency)[0], { target: { value: "LBP" } });
    expect(onChange.mock.calls[0][0].changes).toEqual([
      { key: "usd-change", amountText: "", currency: "LBP", walletId: lbp.id },
      draft.changes[1],
    ]);
  });

  it("keeps money fields LTR in Arabic and reports mismatched cash", () => {
    render(<div dir="rtl"><CashSettlementFields draft={{ ...draft, tenderText: "12" }} payCurrency="USD" costCurrency="USD" costMinor={1250}
      wallets={[usd, lbp]} labels={{ ...labels, tender: "المبلغ المدفوع" }} onChange={vi.fn()} /></div>);
    expect(screen.getByLabelText("المبلغ المدفوع").getAttribute("dir")).toBe("ltr");
    for (const input of screen.getAllByLabelText(labels.change)) expect(input.getAttribute("dir")).toBe("ltr");
    expect(screen.getByRole("alert").textContent).toBe(labels.errors.mismatch);
  });
});
