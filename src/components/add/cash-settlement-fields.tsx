"use client";

import { BalancePicker } from "./balance-picker";
import type { WalletContainer } from "@/features/wallets/schema";
import { Plus, Trash2 } from "lucide-react";
import { TextField } from "@/components/ui/text-field";
import { parseAmount, toInputText, type CurrencyDefinition } from "@/lib/money";
import { MAX_EXTRA_TENDERS, validateSettlement, type CashSettlementInput, type SettlementError, type SettlementRate } from "@/features/transactions/settlement";
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
/** One additional payment line: an exact amount handed over from another balance. */
export type CashTenderDraft = { key: string; amountText: string; currency: string; balanceId: string };
export type CashSettlementDraft = {
  enabled: boolean;
  /** Amount handed over from the transaction's own paying balance. */
  tenderText: string;
  /** Opt-in further payments; absent or empty is the ordinary one-payment purchase. */
  extraTenders?: CashTenderDraft[];
  changes: CashChangeDraft[];
};
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
  const tendersBefore = original.extraTenders ?? [];
  const tendersAfter = settlement.extraTenders ?? [];
  if (tendersBefore.length !== tendersAfter.length || tendersBefore.some((before, index) =>
    before.balanceId !== tendersAfter[index].balanceId || before.amountMinor !== tendersAfter[index].amountMinor)) return false;
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
    extraTenders: snapshot?.extraTenders?.map((tender) => ({
      key: newChangeKey(),
      amountText: toInputText(tender.amountMinor, requireDefinition(tender.currency, definitions)),
      currency: tender.currency,
      balanceId: tender.balanceId,
    })) ?? [],
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
  /** Additional payment lines. */
  extraTenderWallet: string;
  extraTenderCurrency: string;
  extraTender: string;
  addTender: string;
  removeTender: string;
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

  const tenderCurrencies: string[] = [];
  const payers: SettlementWallet[] = [];
  const extraTenders: NonNullable<CashSettlementInput["extraTenders"]> = [];
  for (const row of draft.extraTenders ?? []) {
    const amountMinor = parseAmount(row.amountText, requireDefinition(row.currency, definitions));
    if (amountMinor === null) return { ok: false, error: "amount" };
    const payer = wallets.find((balance) => balance.id === row.balanceId && balance.currency === row.currency);
    if (!payer) return { ok: false, error: "walletUnavailable" };
    tenderCurrencies.push(row.currency);
    payers.push(payer);
    extraTenders.push({ balanceId: payer.id, amountMinor });
  }
  if (extraTenders.length > MAX_EXTRA_TENDERS) return { ok: false, error: "amount" };

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

  // Sent only when used, so the ordinary one-payment purchase keeps its exact payload.
  const tenderLines = extraTenders.length ? { extraTenders } : {};
  const candidate: CashSettlementInput = { tenderMinor, ...tenderLines, changes };
  const unchanged = unchangedFinancials(editContext, payCurrency, costCurrency, costMinor, candidate);
  if (!unchanged && [...receivers, ...payers].some((balance) => balance.archived)) return { ok: false, error: "walletUnavailable" };
  const settlement: CashSettlementInput = unchanged
    ? candidate
    : { tenderMinor, ...tenderLines, changes: changes.map(({ balanceId: balanceId, amountMinor }) => ({ balanceId, amountMinor })) };
  const validation = validateSettlement({
    costMinor,
    costCurrency,
    payCurrency,
    changeCurrencies: currencies,
    extraTenderCurrencies: tenderCurrencies,
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
  const tenders = draft.extraTenders ?? [];
  const updateTender = (key: string, patch: Partial<CashTenderDraft>) => change({extraTenders:tenders.map((row)=>row.key===key?{...row,...patch}:row)});
  const addTender = () => {
    // Most second payments come from the same wallet in another currency.
    const used = new Set([payerBalanceId, ...tenders.map((row) => row.balanceId)]);
    const open = (id: string) => !used.has(id) && wallets.some((balance) => balance.id === id && !balance.archived &&
      definitions.some((unit) => unit.code === balance.currency && !unit.disabled));
    const live = containers.filter((container) => !container.deleted && !container.needsAttention);
    const own = live.find((container) => container.balances.some((balance) => balance.id === payerBalanceId));
    const next = [...(own ? [own] : []), ...live].flatMap((container) => container.balances)
      .find((balance) => !balance.detached && open(balance.id));
    change({ extraTenders: [...tenders, { key: newChangeKey(), amountText: "", currency: next?.currency ?? payCurrency, balanceId: next?.id ?? "" }] });
  };
  const rowButton = "flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border text-muted-foreground hover:bg-accent";
  const addButton = "flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm font-medium hover:bg-accent";
  return <fieldset disabled={disabled} className="min-w-0 border-t border-border py-3 disabled:opacity-60">
    <legend className="px-1 text-sm font-semibold">{labels.title}</legend>
    <div className="flex min-w-0 flex-col gap-3 pt-2">
      {payerBalanceId !== undefined && onPayerBalanceChange ? <div className="flex flex-col gap-1">
        <BalancePicker label={labels.paidFrom} currencyLabel={labels.payerCurrency ?? labels.currency} wallets={containers} currencies={[...definitions]} value={payerBalanceId} onChange={onPayerBalanceChange}/>
        {payerBalance}
      </div> : null}
      <TextField label={labels.tender} description={payCurrency} value={draft.tenderText} onChange={(event)=>change({tenderText:event.target.value})}
        dir="ltr" disabled={!definitions.some((unit) => unit.code === payCurrency)} inputMode={definitions.find((unit) => unit.code === payCurrency)?.decimalPlaces===0?"numeric":"decimal"} autoComplete="off"/>
      {tenders.map((row)=> <div key={row.key} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-3">
        <BalancePicker label={labels.extraTenderWallet} currencyLabel={labels.extraTenderCurrency} wallets={containers} currencies={[...definitions]} value={row.balanceId} onChange={(id)=>{
          const payer=wallets.find((balance)=>balance.id===id);
          if(payer) updateTender(row.key,{balanceId:id,currency:payer.currency,amountText:payer.currency===row.currency?row.amountText:""});
        }}/>
        <TextField label={labels.extraTender} description={row.currency} value={row.amountText} placeholder="0" onChange={(event)=>updateTender(row.key,{amountText:event.target.value})}
          dir="ltr" disabled={!definitions.some((unit) => unit.code === row.currency)} inputMode={definitions.find((unit) => unit.code === row.currency)?.decimalPlaces===0?"numeric":"decimal"} autoComplete="off"/>
        <button type="button" onClick={()=>change({extraTenders:tenders.filter((item)=>item.key!==row.key)})}
          className={rowButton}><Trash2 aria-hidden className="size-4"/>{labels.removeTender}</button>
      </div>)}
      {tenders.length < MAX_EXTRA_TENDERS ? <button type="button" onClick={addTender} className={addButton}><Plus aria-hidden className="size-4"/>{labels.addTender}</button> : null}
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
  return [pay, cost, ...(draft.extraTenders ?? []).map((tender) => tender.currency), ...draft.changes.map((change) => change.currency)].every((code) => definitions.some((definition) => definition.code === code && !definition.disabled));
}
