"use client";

import { BalancePicker } from "./balance-picker";
import type { WalletContainer } from "@/features/wallets/schema";
import { Plus, Trash2 } from "lucide-react";
import { TextField } from "@/components/ui/text-field";
import { parseAmount, toInputText, type CurrencyDefinition } from "@/lib/money";
import { validateSettlement, type CashSettlementInput, type SettlementError, type SettlementRate } from "@/features/transactions/settlement";
import type { SettlementSnapshot } from "@/features/transactions/settlement-serialization";

/** Cashier choices identify exact durable balance rows and their owning wallet name. */
export type SettlementWallet = { id: string; name: string; currency: string; archived: boolean };
export type CashChangeDraft = {
  key: string;
  amountText: string;
  currency: string;
  balanceId: string;
  /** Read-only compatibility data retained only by an exact historical edit. */
  rate?: SettlementRate;
};
export type CashSettlementDraft = { enabled: boolean; tenderText: string; changes: CashChangeDraft[] };
export type SettlementEditContext = {
  balanceId: string;
  original: { balanceId: string; currency: string; amountMinor: number; settlement: SettlementSnapshot | null };
};

let fallbackKey = 0;
function newChangeKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  fallbackKey += 1;
  return `cash-change-${fallbackKey}`;
}

function unchangedFinancials(
  context: SettlementEditContext | undefined,
  payCurrency: string,
  costCurrency: string,
  costMinor: number,
  settlement: CashSettlementInput,
): boolean {
  if (!context || context.balanceId !== context.original.balanceId || payCurrency !== context.original.settlement?.tenderCurrency ||
      costCurrency !== context.original.currency ||
      costMinor !== context.original.amountMinor) return false;
  const original = context.original.settlement;
  if (!original || original.tenderMinor !== settlement.tenderMinor || original.changes.length !== settlement.changes.length) return false;
  return original.changes.every((before, index) => {
    const after = settlement.changes[index];
    return before.balanceId === after.balanceId && before.amountMinor === after.amountMinor &&
      (["base", "quote", "quoteMajorNumerator", "quoteMajorDenominator"] as const)
        .every((key) => before.rate?.[key] === after.rate?.[key]);
  });
}

export function settlementDraftFromSnapshot(
  snapshot: SettlementSnapshot | null,
  currency: string,
  balanceId: string,
  duplicate = false,
  definitions: readonly CurrencyDefinition[],
): CashSettlementDraft {
  return {
    enabled: snapshot !== null,
    tenderText: snapshot ? toInputText(snapshot.tenderMinor, requireDefinition(snapshot.tenderCurrency, definitions)) : "",
    changes: snapshot?.changes.map((change) => ({
      key: newChangeKey(),
      amountText: toInputText(change.amountMinor, requireDefinition(change.currency, definitions)),
      currency: change.currency,
      balanceId: change.balanceId,
      ...(!duplicate && change.rate ? { rate: change.rate } : {}),
    })) ?? [],
  };
}

export type CashSettlementLabels = {
  title: string;
  paidFrom: string;
  payerCurrency?: string;
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
  payCurrency: string,
  costCurrency: string,
  costMinor: number | null,
  wallets: readonly SettlementWallet[],
  editContext?: SettlementEditContext,
  definitions: readonly CurrencyDefinition[] = [],
): { ok: true; settlement: CashSettlementInput | null } | { ok: false; error: SettlementError | "walletUnavailable" } {
  if (!draft.enabled) return { ok: true, settlement: null };
  if (!enabledDraftCurrencies(draft, definitions, payCurrency, costCurrency)) return { ok: false, error: "walletUnavailable" };
  const tenderMinor = parseAmount(draft.tenderText, requireDefinition(payCurrency, definitions));
  if (costMinor === null || tenderMinor === null) return { ok: false, error: "amount" };

  const currencies: string[] = [];
  const receivers: SettlementWallet[] = [];
  const changes: CashSettlementInput["changes"] = [];
  for (const row of draft.changes) {
    const amountMinor = parseAmount(row.amountText, requireDefinition(row.currency, definitions));
    if (amountMinor === null) return { ok: false, error: "amount" };
    const receiver = wallets.find((balance) => balance.id === row.balanceId && balance.currency === row.currency);
    if (!receiver) return { ok: false, error: "walletUnavailable" };
    currencies.push(row.currency);
    receivers.push(receiver);
    changes.push({ balanceId: receiver.id, amountMinor, ...(row.rate ? { rate: row.rate } : {}) });
  }

  const candidate = { tenderMinor, changes };
  const unchanged = unchangedFinancials(editContext, payCurrency, costCurrency, costMinor, candidate);
  if (!unchanged && receivers.some((receiver) => receiver.archived)) return { ok: false, error: "walletUnavailable" };
  const settlement: CashSettlementInput = unchanged
    ? candidate
    : { tenderMinor, changes: changes.map(({ balanceId: balanceId, amountMinor }) => ({ balanceId, amountMinor })) };
  const validation = validateSettlement({
    costMinor,
    costCurrency,
    payCurrency,
    changeCurrencies: currencies,
    settlement,
  });
  return validation.ok ? { ok: true, settlement } : { ok: false, error: validation.reason };
}

/** Expanded cash-payment details. Every selection resolves an existing balance. */
export function CashSettlementFields({ draft, payCurrency, costCurrency, costMinor, wallets, containers,
  payerBalanceId, payerBalance, labels, onChange, onPayerBalanceChange, disabled = false, editContext, definitions,
}: {
  draft: CashSettlementDraft; payCurrency: string; costCurrency: string; costMinor: number | null;
  wallets: readonly SettlementWallet[]; containers: WalletContainer[]; definitions: readonly CurrencyDefinition[];
  payerBalanceId?: string; payerBalance?: React.ReactNode; labels: CashSettlementLabels;
  onChange: (draft: CashSettlementDraft) => void; onPayerBalanceChange?: (balanceId: string) => void;
  disabled?: boolean; editContext?: SettlementEditContext;
}) {
  const parsed = parseSettlementDraft(draft, payCurrency, costCurrency, costMinor, wallets, editContext, definitions);
  const change = (patch: Partial<CashSettlementDraft>) => onChange({ ...draft, ...patch });
  const updateRow = (key: string, patch: Partial<CashChangeDraft>) => change({changes:draft.changes.map((row)=>row.key===key?{...row,...patch}:row)});
  return <fieldset disabled={disabled} className="min-w-0 border-t border-border py-3 disabled:opacity-60">
    <legend className="px-1 text-sm font-semibold">{labels.title}</legend>
    <div className="flex min-w-0 flex-col gap-3 pt-2">
      {payerBalanceId !== undefined && onPayerBalanceChange ? <div className="flex flex-col gap-1">
        <BalancePicker label={labels.paidFrom} currencyLabel={labels.payerCurrency ?? labels.currency} wallets={containers} currencies={[...definitions]} value={payerBalanceId} onChange={onPayerBalanceChange}/>
        {payerBalance}
      </div> : null}
      <TextField label={labels.tender} description={payCurrency} value={draft.tenderText} onChange={(event)=>change({tenderText:event.target.value})}
        dir="ltr" disabled={!definitions.some((unit) => unit.code === payCurrency)} inputMode={definitions.find((unit) => unit.code === payCurrency)?.decimalPlaces===0?"numeric":"decimal"} autoComplete="off"/>
      {draft.changes.map((row)=> <div key={row.key} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-3">
        <BalancePicker label={labels.wallet} currencyLabel={labels.currency} wallets={containers} currencies={[...definitions]} value={row.balanceId} onChange={(id)=>{
          const receiver=wallets.find((balance)=>balance.id===id);
          if(receiver) updateRow(row.key,{balanceId:id,currency:receiver.currency,amountText:receiver.currency===row.currency?row.amountText:"",rate:undefined});
        }}/>
        <TextField label={labels.change} value={row.amountText} placeholder="0" onChange={(event)=>updateRow(row.key,{amountText:event.target.value,rate:undefined})}
          dir="ltr" disabled={!definitions.some((unit) => unit.code === row.currency)} inputMode={definitions.find((unit) => unit.code === row.currency)?.decimalPlaces===0?"numeric":"decimal"} autoComplete="off"/>
        <button type="button" aria-label={labels.removeChange} onClick={()=>change({changes:draft.changes.filter((item)=>item.key!==row.key)})}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border text-muted-foreground hover:bg-accent"><Trash2 aria-hidden className="size-4"/>{labels.removeChange}</button>
      </div>)}
      <button type="button" onClick={()=>change({changes:[...draft.changes,{key:newChangeKey(),amountText:"",currency:payCurrency,
        balanceId:wallets.find((balance)=>!balance.archived&&balance.id===payerBalanceId)?.id ?? wallets.find((balance)=>!balance.archived&&balance.currency===payCurrency)?.id ?? ""}]})}
        className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm font-medium hover:bg-accent"><Plus aria-hidden className="size-4"/>{labels.addChange}</button>
      {!parsed.ok?<p role="alert" className="text-sm font-medium">{labels.errors[parsed.error]}</p>:null}
    </div>
  </fieldset>;
}

function requireDefinition(code: string, definitions: readonly CurrencyDefinition[]): CurrencyDefinition {
  const definition = definitions.find((currency) => currency.code === code);
  if (!definition) throw new Error("App currency data unavailable");
  return definition;
}
function enabledDraftCurrencies(draft: CashSettlementDraft, definitions: readonly CurrencyDefinition[], pay: string, cost: string): boolean {
  return [pay, cost, ...draft.changes.map((change) => change.currency)].every((code) => definitions.some((definition) => definition.code === code && !definition.disabled));
}
