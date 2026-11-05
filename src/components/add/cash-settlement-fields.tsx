"use client";

import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { TextField } from "@/components/ui/text-field";
import { CURRENCY_DECIMALS, parseAmount, toInputText, type Currency } from "@/lib/money";
import { validateSettlement, type CashSettlementInput, type SettlementError, type SettlementRate } from "@/features/transactions/settlement";
import type { SettlementSnapshot } from "@/features/transactions/settlement-serialization";

export type SettlementWallet = { id: string; name: string; currency: Currency; archived: boolean };
export type CashChangeDraft = {
  key: string;
  amountText: string;
  currency: Currency;
  walletId: string;
  /** Read-only compatibility data retained only by an exact historical edit. */
  rate?: SettlementRate;
};
export type CashSettlementDraft = { enabled: boolean; tenderText: string; changes: CashChangeDraft[] };
export type SettlementEditContext = {
  walletId: string;
  original: { walletId: string; currency: Currency; amountMinor: number; settlement: SettlementSnapshot | null };
};

let fallbackKey = 0;
function newChangeKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  fallbackKey += 1;
  return `cash-change-${fallbackKey}`;
}

function unchangedFinancials(
  context: SettlementEditContext | undefined,
  payCurrency: Currency,
  costCurrency: Currency,
  costMinor: number,
  settlement: CashSettlementInput,
): boolean {
  if (!context || context.walletId !== context.original.walletId || payCurrency !== context.original.settlement?.tenderCurrency ||
      costCurrency !== context.original.currency ||
      costMinor !== context.original.amountMinor) return false;
  const original = context.original.settlement;
  if (!original || original.tenderMinor !== settlement.tenderMinor || original.changes.length !== settlement.changes.length) return false;
  return original.changes.every((before, index) => {
    const after = settlement.changes[index];
    return before.walletId === after.walletId && before.amountMinor === after.amountMinor &&
      (["base", "quote", "quoteMajorNumerator", "quoteMajorDenominator"] as const)
        .every((key) => before.rate?.[key] === after.rate?.[key]);
  });
}

export function settlementDraftFromSnapshot(
  snapshot: SettlementSnapshot | null,
  currency: Currency,
  walletId: string,
  duplicate = false,
): CashSettlementDraft {
  return {
    enabled: snapshot !== null,
    tenderText: snapshot ? toInputText(snapshot.tenderMinor, snapshot.tenderCurrency) : "",
    changes: snapshot?.changes.map((change) => ({
      key: newChangeKey(),
      amountText: toInputText(change.amountMinor, change.currency),
      currency: change.currency,
      walletId: change.walletId,
      ...(!duplicate && change.rate ? { rate: change.rate } : {}),
    })) ?? [],
  };
}

export type CashSettlementLabels = {
  title: string;
  tender: string;
  change: string;
  currency: string;
  wallet: string;
  addChange: string;
  removeChange: string;
  selectWallet: string;
  errors: Record<SettlementError | "walletUnavailable", string>;
};

/** Parent uses this same pure parser for Save validity; incomplete text is never dropped. */
export function parseSettlementDraft(
  draft: CashSettlementDraft,
  payCurrency: Currency,
  costCurrency: Currency,
  costMinor: number | null,
  wallets: readonly SettlementWallet[],
  editContext?: SettlementEditContext,
): { ok: true; settlement: CashSettlementInput | null } | { ok: false; error: SettlementError | "walletUnavailable" } {
  if (!draft.enabled) return { ok: true, settlement: null };
  const tenderMinor = parseAmount(draft.tenderText, payCurrency);
  if (costMinor === null || tenderMinor === null) return { ok: false, error: "amount" };

  const currencies: Currency[] = [];
  const receivers: SettlementWallet[] = [];
  const changes: CashSettlementInput["changes"] = [];
  for (const row of draft.changes) {
    const amountMinor = parseAmount(row.amountText, row.currency);
    if (amountMinor === null) return { ok: false, error: "amount" };
    const receiver = wallets.find((wallet) => wallet.id === row.walletId && wallet.currency === row.currency);
    if (!receiver) return { ok: false, error: "walletUnavailable" };
    currencies.push(row.currency);
    receivers.push(receiver);
    changes.push({ walletId: receiver.id, amountMinor, ...(row.rate ? { rate: row.rate } : {}) });
  }

  const candidate = { tenderMinor, changes };
  const unchanged = unchangedFinancials(editContext, payCurrency, costCurrency, costMinor, candidate);
  if (!unchanged && receivers.some((receiver) => receiver.archived)) return { ok: false, error: "walletUnavailable" };
  const settlement: CashSettlementInput = unchanged
    ? candidate
    : { tenderMinor, changes: changes.map(({ walletId, amountMinor }) => ({ walletId, amountMinor })) };
  const validation = validateSettlement({
    costMinor,
    costCurrency,
    payCurrency,
    changeCurrencies: currencies,
    settlement,
  });
  return validation.ok ? { ok: true, settlement } : { ok: false, error: validation.reason };
}

/** Controlled optional section. All copy is provided by bilingual message integration. */
export function CashSettlementFields({
  draft,
  payCurrency,
  costCurrency,
  costMinor,
  wallets,
  labels,
  onChange,
  disabled = false,
  editContext,
}: {
  draft: CashSettlementDraft;
  payCurrency: Currency;
  costCurrency: Currency;
  costMinor: number | null;
  wallets: readonly SettlementWallet[];
  labels: CashSettlementLabels;
  onChange: (draft: CashSettlementDraft) => void;
  onCreateWallet?: () => void;
  disabled?: boolean;
  editContext?: SettlementEditContext;
}) {
  const id = useId();
  const currencies = Object.keys(CURRENCY_DECIMALS) as Currency[];
  const originalChanges = editContext?.original.settlement?.changes ?? [];
  const parsed = parseSettlementDraft(draft, payCurrency, costCurrency, costMinor, wallets, editContext);
  const selectClass = "h-12 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-ring";
  const change = (patch: Partial<CashSettlementDraft>) => onChange({ ...draft, ...patch });
  const updateRow = (key: string, patch: Partial<CashChangeDraft>) =>
    change({ changes: draft.changes.map((row) => row.key === key ? { ...row, ...patch } : row) });

  return (
    <fieldset disabled={disabled} className="min-w-0 border-t border-border py-2 disabled:opacity-60">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
        <input type="checkbox" checked={draft.enabled} disabled={disabled || (draft.enabled && payCurrency !== costCurrency)}
          onChange={(event) => change({ enabled: event.target.checked })}
          className="size-5 accent-primary" aria-controls={`${id}-fields`} />
        {labels.title}
      </label>
      {draft.enabled ? (
        <div id={`${id}-fields`} className="flex min-w-0 flex-col gap-3 pt-2">
          <div className="flex flex-col gap-1">
            <bdi dir="ltr" className="text-sm text-muted-foreground">{payCurrency}</bdi>
            <TextField type="text" label={labels.tender} value={draft.tenderText}
              onChange={(event) => change({ tenderText: event.target.value })} dir="ltr"
              inputMode={CURRENCY_DECIMALS[payCurrency] ? "decimal" : "numeric"} autoComplete="off" />
          </div>

          {draft.changes.map((row, index) => {
            const originalWalletIds = new Set(originalChanges.filter((item) => item.currency === row.currency).map((item) => item.walletId));
            const receivers = wallets.filter((wallet) => wallet.currency === row.currency && (!wallet.archived || originalWalletIds.has(wallet.id)));
            return (
              <div key={row.key} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-3">
                <div className="flex items-start gap-2">
                  <label htmlFor={`${id}-currency-${index}`} className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium">
                    {labels.currency}
                    <select id={`${id}-currency-${index}`} aria-label={labels.currency} className={selectClass} value={row.currency}
                      onChange={(event) => {
                        const currency = event.target.value as Currency;
                        updateRow(row.key, {
                          currency,
                          amountText: "",
                          walletId: wallets.find((wallet) => !wallet.archived && wallet.currency === currency)?.id ??
                            originalChanges.find((item) => item.currency === currency)?.walletId ?? "",
                          rate: undefined,
                        });
                      }}>
                      {currencies.map((currency) => <option key={currency} value={currency}
                        disabled={!wallets.some((wallet) => !wallet.archived && wallet.currency === currency) &&
                          !originalChanges.some((item) => item.currency === currency)}>{currency}</option>)}
                    </select>
                  </label>
                  <button type="button" aria-label={labels.removeChange} onClick={() => change({ changes: draft.changes.filter((item) => item.key !== row.key) })}
                    className="mt-7 flex size-12 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent">
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </div>
                <TextField type="text" label={labels.change} value={row.amountText} placeholder="0"
                  onChange={(event) => updateRow(row.key, { amountText: event.target.value, rate: undefined })} dir="ltr"
                  inputMode={CURRENCY_DECIMALS[row.currency] ? "decimal" : "numeric"} autoComplete="off" />
                {receivers.length > 0 ? (
                  <label htmlFor={`${id}-wallet-${index}`} className="flex flex-col gap-1.5 text-sm font-medium">
                    {labels.wallet}
                    <select id={`${id}-wallet-${index}`} aria-label={labels.wallet} value={row.walletId}
                      onChange={(event) => updateRow(row.key, { walletId: event.target.value, rate: undefined })} className={selectClass}>
                      <option value="">{labels.selectWallet}</option>
                      {receivers.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name} · {wallet.currency}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
            );
          })}

          <button type="button" onClick={() => change({ changes: [...draft.changes, {
            key: newChangeKey(), amountText: "", currency: payCurrency,
            walletId: wallets.find((wallet) => !wallet.archived && wallet.currency === payCurrency)?.id ?? "",
          }] })} className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm font-medium hover:bg-accent">
            <Plus aria-hidden className="size-4" />
            {labels.addChange}
          </button>
          {!parsed.ok ? <p role="alert" className="text-sm font-medium">{labels.errors[parsed.error]}</p> : null}
        </div>
      ) : null}
    </fieldset>
  );
}
