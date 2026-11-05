"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { createCurrency, deleteCurrency, updateCurrency } from "@/features/currencies/actions";
import { currencyInputSchema } from "@/features/currencies/schema";
import type { ActionError } from "@/lib/supabase/action";
import { formatAmount } from "@/lib/money";
import type { CurrencyDefinition } from "@/lib/currency";

const inputClass = "h-12 w-full rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:bg-secondary disabled:text-muted-foreground";

function errorKey(error: ActionError): "errorInvalid" | "errorDuplicate" | "errorUsed" | "errorUnavailable" | "errorBlocked" | "errorFailed" {
  if (error === "invalid") return "errorInvalid";
  if (error === "duplicateCurrency") return "errorDuplicate";
  if (error === "currencyUsed") return "errorUsed";
  if (error === "currencyUnavailable") return "errorUnavailable";
  if (["currencyNonzero", "currencyInUse", "lastEnabledCurrency", "lastWalletBalance"].includes(error)) return "errorBlocked";
  return "errorFailed";
}

function Editor({ currency, onOpenChange }: { currency: CurrencyDefinition | null; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("CurrencySettings");
  const formId = useId();
  const [code, setCode] = useState(currency?.code ?? "");
  const [symbol, setSymbol] = useState(currency?.symbol ?? "");
  const [decimalPlaces, setDecimalPlaces] = useState(String(currency?.decimalPlaces ?? 2));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const parsed = currencyInputSchema.safeParse({ code, symbol, decimalPlaces: Number(decimalPlaces) });
  const title = confirmingDelete
    ? t("deleteTitle", { code: currency?.code ?? "" })
    : currency ? t("editTitle", { code: currency.code }) : t("createTitle");

  const save = () => {
    if (!parsed.success || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = currency
          ? await updateCurrency(currency.code, parsed.data)
          : await createCurrency(parsed.data);
        if (!result.ok) { setError(t(errorKey(result.error))); return; }
        onOpenChange(false);
      } catch {
        setError(t("errorFailed"));
      }
    });
  };

  const remove = () => {
    if (!currency || currency.firstUsed || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteCurrency(currency.code);
        if (!result.ok) { setError(t(errorKey(result.error))); return; }
        onOpenChange(false);
      } catch {
        setError(t("errorFailed"));
      }
    });
  };

  return <SheetShell
    open
    onOpenChange={(next) => { if (!pending) onOpenChange(next); }}
    title={title}
    dismissible={!pending}
    footer={<div className="flex flex-col gap-2">
      {error ? <p role="alert" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm">{error}</p> : null}
      {confirmingDelete ? <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" disabled={pending} onClick={() => { setConfirmingDelete(false); setError(null); }}>{t("cancel")}</Button>
        <Button disabled={pending} onClick={remove}>{pending ? t("deleting") : t("confirmDelete")}</Button>
      </div> : <Button type="submit" form={formId} variant="action" size="lg" disabled={!parsed.success || pending}>{pending ? t("saving") : t("save")}</Button>}
    </div>}
  >
    {confirmingDelete ? <div className="flex flex-col gap-3 text-[15px]"><p>{t("deleteCopy")}</p><p className="font-semibold"><bdi dir="ltr">{currency?.code}</bdi></p></div> :
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); save(); }} className="flex flex-col gap-4" aria-busy={pending}>
        <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor={`${formId}-code`}>{t("code")}
          <input id={`${formId}-code`} className={inputClass} value={code} onChange={(event) => setCode(event.target.value)} dir="ltr" autoCapitalize="characters" autoComplete="off" disabled={pending || currency?.firstUsed === true} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor={`${formId}-symbol`}>{t("symbol")}
          <input id={`${formId}-symbol`} className={inputClass} value={symbol} onChange={(event) => setSymbol(event.target.value)} dir="ltr" autoComplete="off" disabled={pending} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor={`${formId}-decimals`}>{t("decimalPlaces")}
          <input id={`${formId}-decimals`} className={inputClass} type="number" min={0} max={8} step={1} inputMode="numeric" value={decimalPlaces} onChange={(event) => setDecimalPlaces(event.target.value)} dir="ltr" disabled={pending || currency?.firstUsed === true} />
        </label>
        {currency?.firstUsed ? <p className="text-sm text-muted-foreground">{t("usedHelp")}</p> : null}
        <div className="rounded-xl border border-border bg-secondary/50 p-3">
          <p className="text-xs font-medium text-muted-foreground">{t("preview")}</p>
          <bdi data-testid="currency-preview" dir="ltr" className="mt-1 block text-lg font-semibold">{parsed.success ? formatAmount(123456, { ...parsed.data, disabled: false, firstUsed: false }) : "—"}</bdi>
        </div>
        {currency && !currency.firstUsed ? <Button type="button" variant="outline" disabled={pending} onClick={() => { setConfirmingDelete(true); setError(null); }}>{t("delete")}</Button> : null}
      </form>}
  </SheetShell>;
}

export function CurrencySheet({ currency, open, onOpenChange }: { currency: CurrencyDefinition | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!open) return null;
  return <Editor key={currency?.code ?? "new"} currency={currency} onOpenChange={onOpenChange} />;
}
