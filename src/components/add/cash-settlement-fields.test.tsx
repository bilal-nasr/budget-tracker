// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CashSettlementFields,
  parseSettlementDraft as parseDraft,
  settlementDraftFromSnapshot as fromSnapshot,
  type CashSettlementDraft,
  type CashSettlementLabels,
} from "./cash-settlement-fields";

import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";
const parseSettlementDraft = (...args: Parameters<typeof parseDraft>) => parseDraft(args[0], args[1], args[2], args[3], args[4], args[5], SEED_CURRENCY_DEFINITIONS);
const settlementDraftFromSnapshot = (snapshot: Parameters<typeof fromSnapshot>[0], currency: string, balanceId: string, duplicate = false) => fromSnapshot(snapshot, currency, balanceId, duplicate, SEED_CURRENCY_DEFINITIONS);
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
    { key: "usd-change", amountText: "5", currency: "USD", balanceId: usd.id },
    { key: "lbp-change", amountText: "223750", currency: "LBP", balanceId: lbp.id },
  ],
};
const editContext = {
  balanceId: usd.id,
  original: {
    balanceId: usd.id,
    currency: usd.currency,
    amountMinor: 1250,
    settlement: {
      tenderMinor: 2000,
      tenderCurrency: "USD" as const,
      changes: [
        { balanceId: usd.id, amountMinor: 500, currency: usd.currency },
        { balanceId: lbp.id, amountMinor: 223750, currency: lbp.currency, rate: historicalRate },
      ],
    },
  },
};
const containers = [usd, lbp].map((balance) => ({id: balance.id, name: balance.name, kind: "cash" as const, position:0, deleted:false, needsAttention:false, defaultBalanceId:balance.id, balances:[{...balance,walletId:balance.id,position:0,openingBalanceMinor:0,balanceMinor:0,detached:false}]}));
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
          { balanceId: usd.id, amountMinor: 500 },
          { balanceId: lbp.id, amountMinor: 223750 },
        ],
      },
    });
    expect(parseSettlementDraft({ ...draft, enabled: false }, "USD", "USD", 1250, [])).toEqual({ ok: true, settlement: null });
  });

  it("hydrates every saved change and drops historical rates only when duplicating", () => {
    const snapshot = editContext.original.settlement;
    const editing = settlementDraftFromSnapshot(snapshot, "USD", usd.id);
    expect(editing.changes).toHaveLength(2);
    expect(editing.changes[1]).toMatchObject({ amountText: "223750", currency: "LBP", balanceId: lbp.id, rate: historicalRate });
    expect(settlementDraftFromSnapshot(snapshot, "USD", usd.id, true).changes[1].rate).toBeUndefined();
  });

  it("retains archived original receivers only for an exact financial edit", () => {
    const archivedWallets = [{ ...usd, archived: true }, { ...lbp, archived: true }];
    const historicalDraft = settlementDraftFromSnapshot(editContext.original.settlement, "USD", usd.id);
    expect(parseSettlementDraft(historicalDraft, "USD", "USD", 1250, archivedWallets, editContext).ok).toBe(true);
    expect(parseSettlementDraft(historicalDraft, "USD", "USD", 1250, archivedWallets)).toEqual({ ok: false, error: "walletUnavailable" });
    expect(parseSettlementDraft({ ...historicalDraft, tenderText: "21" }, "USD", "USD", 1250, archivedWallets, editContext))
      .toEqual({ ok: false, error: "walletUnavailable" });
    expect(parseSettlementDraft(historicalDraft, "USD", "USD", 1250, archivedWallets, { ...editContext, balanceId: "another-paying-wallet" }))
      .toEqual({ ok: false, error: "walletUnavailable" });
  });

  it("renders both saved returns and keeps archived original receivers visible", () => {
    const historicalDraft = settlementDraftFromSnapshot(editContext.original.settlement, "USD", usd.id);
    render(<CashSettlementFields containers={containers} definitions={SEED_CURRENCY_DEFINITIONS} draft={historicalDraft} payCurrency="USD" costCurrency="USD" costMinor={1250}
      wallets={[{ ...usd, archived: true }, { ...lbp, archived: true }]} editContext={editContext}
      labels={labels} onChange={vi.fn()} />);
    expect(screen.getAllByLabelText(labels.change).map((input) => (input as HTMLInputElement).value)).toEqual(["5", "223750"]);
    expect(screen.getAllByLabelText(labels.wallet).map((select) => (select as HTMLSelectElement).value)).toEqual([usd.id, lbp.id]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: labels.title })).toBeNull();
  });

  it("adds and removes independent change rows", () => {
    const onChange = vi.fn();
    render(<CashSettlementFields containers={containers} definitions={SEED_CURRENCY_DEFINITIONS} draft={draft} payCurrency="USD" costCurrency="USD" costMinor={1250} wallets={[usd, lbp]}
      labels={labels} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: labels.addChange }));
    expect(onChange.mock.calls[0][0].changes).toHaveLength(3);
    fireEvent.click(screen.getAllByRole("button", { name: labels.removeChange })[0]);
    expect(onChange.mock.calls[1][0].changes).toEqual([draft.changes[1]]);
  });

  it("resets only the changed row when its currency changes", () => {
    const onChange = vi.fn();
    render(<CashSettlementFields containers={containers} definitions={SEED_CURRENCY_DEFINITIONS} draft={draft} payCurrency="USD" costCurrency="USD" costMinor={1250} wallets={[usd, lbp]}
      labels={labels} onChange={onChange} />);
    fireEvent.change(screen.getAllByLabelText(labels.wallet)[0], { target: { value: lbp.id } });
    expect(onChange.mock.calls[0][0].changes).toEqual([
      { key: "usd-change", amountText: "", currency: "LBP", balanceId: lbp.id },
      draft.changes[1],
    ]);
  });

  it("keeps money fields LTR in Arabic and reports mismatched cash", () => {
    render(<div dir="rtl"><CashSettlementFields containers={containers} definitions={SEED_CURRENCY_DEFINITIONS} draft={{ ...draft, tenderText: "12" }} payCurrency="USD" costCurrency="USD" costMinor={1250}
      wallets={[usd, lbp]} labels={{ ...labels, tender: "المبلغ المدفوع" }} onChange={vi.fn()} /></div>);
    expect(screen.getByLabelText("المبلغ المدفوع").getAttribute("dir")).toBe("ltr");
    for (const input of screen.getAllByLabelText(labels.change)) expect(input.getAttribute("dir")).toBe("ltr");
    expect(screen.getByRole("alert").textContent).toBe(labels.errors.mismatch);
  });
});

it("parses custom precision-eight cashier amounts and rejects disabled new tender/cost/change",()=>{
 const custom={code:"TOKEN8",symbol:"T",decimalPlaces:8,disabled:false,firstUsed:true};
 const exact={id:"d0000000-0000-4000-8000-000000000001",name:"Any wallet",currency:"TOKEN8",archived:false};
 const value:CashSettlementDraft={enabled:true,tenderText:"2.50000001",changes:[{key:"change",amountText:"0.00000002",currency:"TOKEN8",balanceId:exact.id}]};
 expect(parseDraft(value,"TOKEN8","TOKEN8",249999999,[exact],undefined,[custom])).toEqual({ok:true,settlement:{tenderMinor:250000001,changes:[{balanceId:exact.id,amountMinor:2}]}});
 expect(parseDraft(value,"TOKEN8","TOKEN8",249999999,[exact],undefined,[{...custom,disabled:true}])).toEqual({ok:false,error:"walletUnavailable"});
 const snapshot={tenderMinor:250000001,tenderCurrency:"TOKEN8",changes:[{balanceId:exact.id,currency:"TOKEN8",amountMinor:2}]};
 expect(fromSnapshot(snapshot,"TOKEN8",exact.id,false,[{...custom,disabled:true}])).toMatchObject({tenderText:"2.50000001",changes:[{amountText:"0.00000002"}]});
});
