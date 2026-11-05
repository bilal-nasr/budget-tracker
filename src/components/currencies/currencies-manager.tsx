"use client";

import { cn } from "@/lib/utils";
import { useMemo, useState, useTransition } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { Link } from "@/i18n/navigation";
import { inspectCurrencyDisable, setCurrencyEnabled, type CurrencyDisableBlocker } from "@/features/currencies/actions";
import type { CurrencyDefinition } from "@/lib/currency";
import { formatAmount } from "@/lib/money";
import { CurrencySheet } from "./currency-sheet";

type DisableState = {
  currency: CurrencyDefinition;
  blockers: CurrencyDisableBlocker[] | null;
  error: string | null;
};

function Blocker({ blocker }: { blocker: CurrencyDisableBlocker }) {
  const t = useTranslations("CurrencySettings");
  if (blocker.kind === "lastEnabledCurrency") return <span>{t("blockerLastEnabled")}</span>;
  if (blocker.kind === "nonzeroBalance" || blocker.kind === "lastWalletBalance" || blocker.kind === "salary") {
    const copy = blocker.kind === "nonzeroBalance" ? "blockerNonzero" : blocker.kind === "lastWalletBalance" ? "blockerLastBalance" : "blockerSalary";
    return <span><Link href="/wallets" className="font-medium text-primary underline underline-offset-4"><bdi>{blocker.walletName}</bdi></Link>{" · "}{t(copy, { wallet: "" })}</span>;
  }
  if (blocker.kind === "fixedExpense") return <span>{t("blockerFixed", { name: blocker.name })}</span>;
  if (blocker.kind === "installment") return <span>{t("blockerInstallment", { name: blocker.name })}</span>;
  if (blocker.kind === "loan") return <Link href="/loans" className="text-primary underline underline-offset-4">{t("blockerLoan", { name: blocker.name })}</Link>;
  if (blocker.kind === "pendingPayment") return <Link href="/pending-payments" className="text-primary underline underline-offset-4">{t("blockerPending", { name: blocker.label })}</Link>;
  return <Link href="/budgets" className="text-primary underline underline-offset-4">{t("blockerBudget", { month: blocker.startsMonth.slice(0, 7) })}</Link>;
}

export function CurrenciesManager({ currencies }: { currencies: CurrencyDefinition[] }) {
  const t = useTranslations("CurrencySettings");
  const [editor, setEditor] = useState<CurrencyDefinition | "new" | null>(null);
  const [disable, setDisable] = useState<DisableState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ordered = useMemo(() => [
    ...currencies.filter((currency) => !currency.disabled),
    ...currencies.filter((currency) => currency.disabled),
  ], [currencies]);
  const enabledCount = currencies.filter((currency) => !currency.disabled).length;

  const beginDisable = (currency: CurrencyDefinition) => {
    if (currency.disabled || enabledCount <= 1 || pending) return;
    setError(null);
    setDisable({ currency, blockers: null, error: null });
    startTransition(async () => {
      try {
        const blockers = await inspectCurrencyDisable(currency.code);
        setDisable((current) => current?.currency.code === currency.code ? { ...current, blockers } : current);
      } catch {
        setDisable((current) => current?.currency.code === currency.code ? { ...current, blockers: [], error: t("errorFailed") } : current);
      }
    });
  };

  const changeEnabled = (currency: CurrencyDefinition, enabled: boolean) => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await setCurrencyEnabled(currency.code, enabled);
        if (!result.ok) {
          const blocked = ["currencyNonzero", "currencyInUse", "lastEnabledCurrency", "lastWalletBalance"].includes(result.error);
          const message = t(blocked ? "errorBlocked" : result.error === "currencyUnavailable" ? "errorUnavailable" : "errorFailed");
          if (!enabled) setDisable((current) => current ? { ...current, error: message } : current);
          else setError(message);
          return;
        }
        if (!enabled) setDisable(null);
      } catch {
        if (!enabled) setDisable((current) => current ? { ...current, error: t("errorFailed") } : current);
        else setError(t("errorFailed"));
      }
    });
  };

  return <div className="flex flex-col gap-5">
    <p className="text-[15px] text-muted-foreground">{t("intro")}</p>
    <Button variant="outline" className="w-full gap-2" onClick={() => setEditor("new")}><Plus aria-hidden className="size-4" />{t("add")}</Button>
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {ordered.map((currency) => <li key={currency.code} data-testid="currency-row" className={cn("flex min-h-20 items-center gap-3 px-3 py-2", currency.disabled && "bg-over-soft")}>
        <button type="button" aria-label={t("editNamed", { code: currency.code })} onClick={() => setEditor(currency)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-start focus-visible:outline-2 focus-visible:outline-ring">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-sm font-semibold"><bdi dir="ltr">{currency.symbol}</bdi></span>
          <span className="min-w-0 flex-1">
            <bdi data-testid="currency-code" dir="ltr" className="block font-semibold">{currency.code}</bdi>
            <span className="block truncate text-sm text-muted-foreground"><bdi dir="ltr">{formatAmount(123456, currency)}</bdi>{" · "}{currency.decimalPlaces}</span>
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span data-testid={`currency-status-${currency.code}`} className="text-xs text-muted-foreground">{t(currency.disabled ? "disabled" : "enabled")}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || (!currency.disabled && enabledCount <= 1)}
            aria-label={t(currency.disabled ? "enableNamed" : "disableNamed", { code: currency.code })}
            onClick={() => currency.disabled ? changeEnabled(currency, true) : beginDisable(currency)}
          >{t(currency.disabled ? "enabled" : "disabled")}</Button>
        </div>
      </li>)}
    </ul>
    {error ? <p role="alert" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm">{error}</p> : null}
    <CurrencySheet open={editor !== null} currency={editor === "new" ? null : editor} onOpenChange={(open) => { if (!open) setEditor(null); }} />
    <SheetShell
      open={disable !== null}
      onOpenChange={(open) => { if (!open && !pending) setDisable(null); }}
      title={t.rich("disableTitle", { code: disable?.currency.code ?? "", bdi: (chunks) => <bdi dir="ltr">{chunks}</bdi> })}
      description={t("disableCopy")}
      dismissible={!pending}
      footer={disable ? <div className="flex flex-col gap-2">
        {disable.error ? <p role="alert" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm">{disable.error}</p> : null}
        {disable.blockers?.length === 0 && !disable.error ? <div className="grid grid-cols-2 gap-3"><Button variant="outline" disabled={pending} onClick={() => setDisable(null)}>{t("cancel")}</Button><Button disabled={pending} onClick={() => changeEnabled(disable.currency, false)}>{pending ? t("disabling") : t("confirmDisable")}</Button></div> :
          disable.blockers && disable.blockers.length > 0 ? <Button variant="outline" disabled={pending} onClick={() => setDisable(null)}>{t("cancel")}</Button> : null}
      </div> : null}
    >
      {!disable || disable.blockers === null ? <p role="status" className="text-sm text-muted-foreground">{t("checking")}</p> : disable.blockers.length === 0 && !disable.error ? <p>{t("disableReady")}</p> : disable.blockers.length ? <div className="flex flex-col gap-3"><h3 className="font-semibold">{t("blockersTitle")}</h3><ul className="list-disc space-y-2 ps-5 text-sm">{disable.blockers.map((blocker, index) => <li key={`${blocker.kind}-${index}`}><Blocker blocker={blocker} /></li>)}</ul></div> : null}
    </SheetShell>
  </div>;
}
