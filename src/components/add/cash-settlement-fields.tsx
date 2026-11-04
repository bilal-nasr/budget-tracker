"use client";

import { useId } from "react";
import { TextField } from "@/components/ui/text-field";
import { CURRENCY_DECIMALS, parseAmount, toInputText, type Currency } from "@/lib/money";
import { settlementRateText, validateSettlement, type CashSettlementInput, type SettlementError } from "@/features/transactions/settlement";
import type { SettlementSnapshot } from "@/features/transactions/settlement-serialization";

export type SettlementWallet = { id: string; name: string; currency: Currency; archived: boolean };
export type CashSettlementDraft = {
  enabled: boolean; tenderText: string; changeText: string; changeCurrency: Currency;
  changeWalletId: string; rateText: string; rateConfirmed: boolean;
};
export type SettlementEditContext = {
  walletId: string;
  original: { walletId: string; currency: Currency; amountMinor: number; settlement: SettlementSnapshot | null };
};

function unchangedFinancials(context: SettlementEditContext | undefined, payCurrency: Currency, costMinor: number,
  settlement: CashSettlementInput, changeCurrency: Currency): boolean {
  if (!context || context.walletId !== context.original.walletId || payCurrency !== context.original.currency ||
      costMinor !== context.original.amountMinor) return false;
  const original = context.original.settlement;
  const before = original?.change;
  const after = settlement.change;
  return !!original && !!before && !!after && original.tenderMinor === settlement.tenderMinor &&
    before.walletId === after.walletId && before.currency === changeCurrency && before.amountMinor === after.amountMinor &&
    (["base", "quote", "quoteMajorNumerator", "quoteMajorDenominator"] as const)
      .every((key) => before.rate?.[key] === after.rate?.[key]);
}
export function settlementDraftFromSnapshot(snapshot: SettlementSnapshot | null, currency: Currency, walletId: string, duplicate = false): CashSettlementDraft {
  const change = snapshot?.change;
  return {
    enabled: snapshot !== null, tenderText: snapshot ? toInputText(snapshot.tenderMinor, currency) : "",
    changeText: change ? toInputText(change.amountMinor, change.currency) : "",
    changeCurrency: change?.currency ?? currency, changeWalletId: change?.walletId ?? walletId,
    rateText: change?.rate ? settlementRateText(change.rate) : "",
    rateConfirmed: !!change?.rate && !duplicate,
  };
}
export type CashSettlementLabels = {
  title: string; tender: string; change: string; currency: string; wallet: string;
  rate: string; confirmRate: string; createWallet: string; selectWallet: string; noChange: string;
  needWallet: (currency: Currency) => string;
  errors: Record<SettlementError | "walletUnavailable", string>;
};

/** Parent uses this same pure parser for Save validity; incomplete text is never dropped. */
export function parseSettlementDraft(
  draft: CashSettlementDraft, payCurrency: Currency, costMinor: number | null, wallets: readonly SettlementWallet[],
  editContext?: SettlementEditContext,
): { ok: true; settlement: CashSettlementInput | null } | { ok: false; error: SettlementError | "walletUnavailable" } {
  if (!draft.enabled) return { ok: true, settlement: null };
  const tenderMinor = parseAmount(draft.tenderText, payCurrency);
  const changeMinor = draft.changeText.trim() === "" ? 0 : parseAmount(draft.changeText, draft.changeCurrency);
  if (costMinor === null || tenderMinor === null || changeMinor === null) return { ok: false, error: "amount" };
  let change: CashSettlementInput["change"] = null;
  if (changeMinor > 0) {
    const receiver = wallets.find((w) => w.id === draft.changeWalletId && w.currency === draft.changeCurrency);
    if (!receiver) return { ok: false, error: "walletUnavailable" };
    change = { walletId: receiver.id, amountMinor: changeMinor };
    // Retain historical quotes only when editing the exact original money.
    // New and financially changed settlements record actual cash without a quote.
    const originalRate = editContext?.original.settlement?.change?.rate;
    if (originalRate) {
      const historicalChange = { ...change, rate: originalRate };
      if (unchangedFinancials(editContext, payCurrency, costMinor, { tenderMinor, change: historicalChange }, draft.changeCurrency)) {
        change = historicalChange;
      }
    }
    if (receiver.archived && !unchangedFinancials(editContext, payCurrency, costMinor, { tenderMinor, change }, draft.changeCurrency)) {
      return { ok: false, error: "walletUnavailable" };
    }
  }
  const settlement = { tenderMinor, change };
  const validation = validateSettlement({ costMinor, payCurrency, changeCurrency: draft.changeCurrency, settlement });
  return validation.ok ? { ok: true, settlement } : { ok: false, error: validation.reason };
}

/** Controlled optional section. All copy is provided by bilingual message integration. */
export function CashSettlementFields({ draft, payCurrency, costMinor, wallets, labels, onChange, disabled = false, editContext }: {
  draft: CashSettlementDraft; payCurrency: Currency; costMinor: number | null;
  wallets: readonly SettlementWallet[]; labels: CashSettlementLabels;
  onChange: (draft: CashSettlementDraft) => void; onCreateWallet: () => void; disabled?: boolean;
  editContext?: SettlementEditContext;
}) {
  const id = useId();
  const currencies = Object.keys(CURRENCY_DECIMALS) as Currency[];
  const originalChange = editContext?.original.settlement?.change;
  const receivers = wallets.filter((w) => w.currency === draft.changeCurrency && (!w.archived || w.id === originalChange?.walletId));
  const parsed = parseSettlementDraft(draft, payCurrency, costMinor, wallets, editContext);
  const selectClass = "h-12 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-ring";
  const change = (patch: Partial<CashSettlementDraft>) => onChange({ ...draft, ...patch });
  return (
    <fieldset disabled={disabled} className="min-w-0 border-t border-border py-2 disabled:opacity-60">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => change({ enabled: e.target.checked })} className="size-5 accent-primary" aria-controls={`${id}-fields`} />
        {labels.title}
      </label>
      {draft.enabled ? (
        <div id={`${id}-fields`} className="flex min-w-0 flex-col gap-3 pt-2">
          <div className="flex flex-col gap-1">
            <bdi dir="ltr" className="text-sm text-muted-foreground">{payCurrency}</bdi>
            <TextField type="text" label={labels.tender} value={draft.tenderText} onChange={(e) => change({ tenderText: e.target.value })} dir="ltr" inputMode={CURRENCY_DECIMALS[payCurrency] ? "decimal" : "numeric"} autoComplete="off" />
          </div>
          <label htmlFor={`${id}-currency`} className="flex flex-col gap-1.5 text-sm font-medium">
            {labels.currency}
            <select id={`${id}-currency`} className={selectClass} value={draft.changeCurrency} onChange={(e) => {
              const currency = e.target.value as Currency;
              change({ changeCurrency: currency, changeWalletId: wallets.find((w) => !w.archived && w.currency === currency)?.id ??
                (originalChange?.currency === currency ? originalChange.walletId : ""), changeText: "", rateText: "", rateConfirmed: false });
            }}>
              {currencies.map((c) => <option key={c} value={c} disabled={!wallets.some((w) => !w.archived && w.currency === c) && originalChange?.currency !== c}>{c}</option>)}
            </select>
          </label>
          <TextField type="text" label={labels.change} value={draft.changeText} placeholder="0" onChange={(e) => change({ changeText: e.target.value })} dir="ltr" inputMode={CURRENCY_DECIMALS[draft.changeCurrency] ? "decimal" : "numeric"} autoComplete="off" />
          {receivers.length > 0 ? (
            <label htmlFor={`${id}-wallet`} className="flex flex-col gap-1.5 text-sm font-medium">
              {labels.wallet}
              <select id={`${id}-wallet`} value={draft.changeWalletId} onChange={(e) => change({ changeWalletId: e.target.value })} className={selectClass}>
                <option value="">{labels.selectWallet}</option>
                {receivers.map((w) => <option key={w.id} value={w.id} disabled={w.archived && !parsed.ok}>{w.name} · {w.currency}</option>)}
              </select>
            </label>
          ) : null}
          {!parsed.ok ? <p role="alert" className="text-sm font-medium">{labels.errors[parsed.error]}</p> : null}
        </div>
      ) : null}
    </fieldset>
  );
}
