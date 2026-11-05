"use client";
import { useRouter } from "@/i18n/navigation";
import { currencyIntent } from "@/lib/currency-intent";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useAppDataOptional } from "@/components/providers/app-data";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { createWallet, setDefaultWalletBalance, updateWallet } from "@/features/wallets/actions";
import type { WalletContainer, WalletKind } from "@/features/wallets/schema";
import { parseAmount } from "@/lib/money";
import type { CurrencyDefinition } from "@/lib/currency";
import { CurrencySelector } from "./currency-selector";
import { WalletDeleteSheet } from "./wallet-delete-sheet";

export type WalletSheetState = { wallet: WalletContainer | null };

export function WalletForm({ wallet, onDone, submitLabel, currencies: catalog, onAddMoney }: {
  wallet: WalletContainer | null;
  onDone: () => void;
  submitLabel?: string;
  /** Explicit catalog for onboarding, which sits outside AppDataProvider. */
  currencies?: readonly CurrencyDefinition[];
  onAddMoney?: (wallet: WalletContainer) => void;
}) {
  const router = useRouter();
  const t = useTranslations("Wallets");
  const app = useAppDataOptional();
  const currencies = (catalog ?? app?.enabledCurrencies ?? []).filter((item) => !item.disabled);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(wallet?.name ?? "");
  const [kind, setKind] = useState<WalletKind>(wallet?.kind ?? "cash");
  const originalDefault = wallet?.balances.find((balance) => balance.id === wallet.defaultBalanceId);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const currency = currencies.find((item) => item.code === (selectedCode ?? originalDefault?.currency)) ?? currencies[0];
  const [owe, setOwe] = useState(false);
  const [amountDraft, setAmountDraft] = useState<{ text: string; code: string; decimalPlaces: number } | null>(null);
  const draftMatchesCurrency = amountDraft?.code === currency?.code && amountDraft?.decimalPlaces === currency?.decimalPlaces;
  // Discard incompatible drafts so later catalog refreshes cannot revive them.
  if (amountDraft && !draftMatchesCurrency) setAmountDraft(null);
  const amount = draftMatchesCurrency ? amountDraft?.text ?? "" : "";
  const [error, setError] = useState<string | null>(null);
  const parsedAmount = !wallet && amount.trim() !== "" ? currency ? parseAmount(amount, currency) : null : 0;
  const nameOk = name.trim().length > 0;
  const selectedBalance = wallet?.balances.find((balance) => balance.currency === currency?.code && !balance.detached);
  const ready = nameOk && !!currency && parsedAmount !== null && (!wallet || !!selectedBalance) && !wallet?.deleted;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || !currency || parsedAmount === null) return;
    setError(null);
    startTransition(async () => {
      try {
        let result: { ok: boolean; error?: string };
        if (!wallet) {
          result = await createWallet({ expectedUnits: currencyIntent(currency), name: name.trim(), kind, currency: currency.code, openingBalanceMinor: owe ? -parsedAmount : parsedAmount });
        } else {
          result = name.trim() === wallet.name && kind === wallet.kind ? { ok: true } : await updateWallet(wallet.id, { name: name.trim(), kind });
          if (result.ok && selectedBalance && selectedBalance.id !== wallet.defaultBalanceId) result = await setDefaultWalletBalance(wallet.id, selectedBalance.id);
        }
        if (!result.ok) {
        if (result.error === "conflict") { setAmountDraft(null); router.refresh(); } setError(result.error === "notConfigured" ? t("errorPreview") : t("errorFailed")); return; }
        onDone();
      } catch { setError(t("errorFailed")); }
    });
  };

  return <form onSubmit={submit} className="flex min-w-0 flex-col gap-4" noValidate>
    <TextField label={t("name")} value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder={t("namePlaceholder")} autoComplete="off" required disabled={pending} />
    <div className="flex flex-col gap-1.5"><span className="text-sm font-medium">{t("kind")}</span>
      <Segmented label={t("kind")} value={kind} onChange={setKind} options={[{ value: "cash", label: t("cash") }, { value: "bank", label: t("bank") }, { value: "card", label: t("card") }]} />
    </div>
    <CurrencySelector label={t("defaultCurrency")} currencies={currencies} value={currency?.code ?? ""} disabled={pending}
      onChange={(code) => { setSelectedCode(code); setAmountDraft(null); }} />
    <p className="text-sm text-muted-foreground">{t(wallet ? "defaultHelp" : "globalCreateHelp")}</p>
    {!wallet ? <>
      <div className="flex flex-col gap-1.5"><span className="text-sm font-medium">{t("opening")}</span>
        <Segmented label={t("opening")} value={owe ? "owe" : "have"} onChange={(next) => setOwe(next === "owe")} options={[{ value: "have", label: t("have") }, { value: "owe", label: t("owe") }]} />
      </div>
      <TextField label={t("amount")} value={amount} onChange={(event) => setAmountDraft(currency ? { text: event.target.value, code: currency.code, decimalPlaces: currency.decimalPlaces } : null)} inputMode={currency?.decimalPlaces === 0 ? "numeric" : "decimal"} placeholder="0" autoComplete="off" dir="ltr" error={parsedAmount === null ? t("errorAmount") : null} disabled={pending} />
    </> : null}
    {error ? <p role="alert" className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">{error}</p> : null}
    <Button type="submit" size="lg" disabled={pending || !ready} className="w-full">{submitLabel ?? t(wallet ? "saveChanges" : "create")}</Button>
    {wallet && !wallet.deleted && !wallet.needsAttention && onAddMoney ? <Button type="button" variant="outline" disabled={pending} onClick={() => onAddMoney(wallet)}>{t("addMoney")}</Button> : null}
  </form>;
}

export function WalletSheet({ state, onClose, onAddMoney }: {
  state: WalletSheetState | null;
  onClose: () => void;
  onAddMoney?: (wallet: WalletContainer) => void;
}) {
  const t = useTranslations("Wallets");
  const app = useAppDataOptional();
  const wallet = state?.wallet ? app?.walletById(state.wallet.id) ?? state.wallet : null;
  const [deleting, setDeleting] = useState<string | null>(null);
  if (wallet && !wallet.deleted && deleting === wallet.id && app) return <WalletDeleteSheet key={wallet.id} wallet={wallet} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); onClose(); }} />;
  return <SheetShell open={state !== null} onOpenChange={(open) => { if (!open) onClose(); }} title={wallet ? t("editTitle") : t("newTitle")}>
    {state ? <WalletForm key={wallet?.id ?? "new"} wallet={wallet} onDone={onClose} onAddMoney={onAddMoney} /> : null}
    {wallet && !wallet.deleted && app ? <Button variant="destructive" className="mt-4 w-full" onClick={() => setDeleting(wallet.id)}>{t("deleteWallet")}</Button> : null}
  </SheetShell>;
}
