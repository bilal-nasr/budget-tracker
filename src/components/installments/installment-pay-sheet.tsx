"use client";

import { useRef, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useDisplayPrefs } from "@/components/providers/display-prefs";
import { useAppData } from "@/components/providers/app-data";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { payInstallment } from "@/features/installments/actions";
import { canPayNormally, paymentAmountDefault, type Installment } from "@/features/installments/cycle";
import { cyclePaymentInputSchema, type CyclePaymentInput } from "@/features/installments/cycle-input";
import { deleteTransaction } from "@/features/transactions/actions";
import { todayIn } from "@/features/transactions/group";
import { useRouter } from "@/i18n/navigation";
import { CURRENCY_DECIMALS, formatAmount, parseAmount, toInputText } from "@/lib/money";
import { cn } from "@/lib/utils";

export type InstallmentPayState = { item: Installment; intent: "normal" | "again"; requestId: string };

function Form({ state, onClose, onBusy }: { state: InstallmentPayState; onClose: () => void; onBusy: (busy: boolean) => void }) {
  const { item, intent, requestId } = state;
  const t = useTranslations("Installments");
  const tb = useTranslations("Breakdown");
  const tc = useTranslations("Categories");
  const router = useRouter();
  const { wallets, timezone } = useAppData();
  const { digits } = useDisplayPrefs();
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const attempted = useRef<CyclePaymentInput | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [confirmation, setConfirmation] = useState<CyclePaymentInput | null>(null);
  const usable = wallets.filter((w) => !w.archived && w.currency === item.currency)
    .sort((a,b) => Number(b.id === item.walletId) - Number(a.id === item.walletId));
  const today = todayIn(timezone);
  const [walletId, setWalletId] = useState(usable[0]?.id ?? "");
  const [amount, setAmount] = useState(() => toInputText(paymentAmountDefault(item), item.currency));
  const [date, setDate] = useState(today);
  const [showDate, setShowDate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minor = amount.trim() === "" ? null : parseAmount(amount, item.currency);
  const money = (value: number) => `⁦${formatAmount(value, item.currency, { digits })}⁩`;
  const tooMuch = minor !== null && minor > item.remainingMinor;
  const amountError = amount.trim() !== "" && minor === null ? t("errorAmount")
    : tooMuch ? t("tooMuch", { amount: money(item.remainingMinor) }) : null;
  const input = { requestId, installmentId: item.id, walletId, amountMinor: minor ?? 0, occurredOn: date,
    salaryCycleId: item.salaryCycleId, overrideOfTransactionId: intent === "again" ? item.cycleLatestPaymentId : null };
  const validIntent = item.remainingMinor > 0 && (intent === "again" ? item.cycleLatestPaymentId !== null : canPayNormally(item));
  const canSave = validIntent && !tooMuch && date <= today && cyclePaymentInputSchema.safeParse(input).success;

  const submit = (payload: CyclePaymentInput) => {
    if (inFlight.current || blocked) return;
    inFlight.current = true;
    onBusy(true);
    attempted.current = payload;
    setFrozen(true);
    setConfirmation(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await payInstallment(payload);
        if (!result.ok) {
          if (result.error === "failed") { setError(t("errorUncertain")); return; }
          attempted.current = null;
          setFrozen(false);
          const stale = ["cycleChanged", "paymentChanged", "alreadyPaidThisCycle", "requestAlreadyUsed"].includes(result.error);
          setBlocked(stale);
          setError(result.error === "notConfigured" ? t("errorPreview")
            : result.error === "exceedsRemaining" ? t("tooMuch", { amount: money(item.remainingMinor) })
            : result.error === "cycleChanged" ? t("cycleChanged")
            : result.error === "paymentChanged" ? t("paymentChanged")
            : result.error === "alreadyPaidThisCycle" ? t("alreadyPaid")
            : result.error === "requestAlreadyUsed" ? t("requestAlreadyUsed")
            : result.error === "categoryUnavailable" ? tc("errorUnavailable") : t("errorFailed"));
          return;
        }
        onClose();
        toast(t("recorded"), { action: { label: t("undo"), onClick: async () => {
          const undone = await deleteTransaction(result.id, result.revision);
          if (!undone.ok) toast.error(undone.error === "conflict" ? tb("conflict") : t("errorFailed"));
        } } });
      } catch { setError(t("errorUncertain")); }
      finally { inFlight.current = false; onBusy(false); }
    });
  };
  const save = () => {
    if (attempted.current) { submit(attempted.current); return; }
    if (!canSave || pending || blocked) return;
    const payload = cyclePaymentInputSchema.parse(input);
    if (intent === "again") setConfirmation(payload);
    else submit(payload);
  };
  // A retained submission is reconciled with its original UUID/wallet/amount,
  // even if refreshed provider data no longer permits a NEW payment. Likewise,
  // a stale-intent Review action must remain reachable without an active wallet.
  if (usable.length === 0 && !frozen && !blocked) return <p className="py-6 text-center text-[15px] text-muted-foreground">{t("noWalletForCurrency")}</p>;
  return <form className="flex flex-col gap-4" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
    <p className="text-[13px] text-muted-foreground">{t(item.salaryCycleId === null ? "initialCycleHelp" : "cycleHelp")}</p>
    <fieldset disabled={pending || frozen || blocked} className="flex min-w-0 flex-col gap-4 border-0 p-0">
      <TextField label={t("amount")} value={amount} onChange={(e) => setAmount(e.target.value)}
        inputMode={CURRENCY_DECIMALS[item.currency] === 0 ? "numeric" : "decimal"} autoComplete="off" dir="ltr" error={amountError} />
      <p className="-mt-2 text-[13px] text-muted-foreground">{t.rich("leftAfterRich", {
        amount: () => <Amount minor={Math.max(0,item.remainingMinor-(minor ?? 0))} currency={item.currency} />,
      })}</p>
      <div className="flex flex-col gap-1.5">
        <span id="pay-wallet" className="text-sm font-medium">{t("paidFrom")}</span>
        <div role="radiogroup" aria-labelledby="pay-wallet" className="flex flex-wrap gap-2">
          {usable.map((w) => <button key={w.id} type="button" role="radio" aria-checked={w.id === walletId} onClick={() => setWalletId(w.id)}
            className="min-h-11 rounded-full border border-border bg-card px-4 text-sm font-medium aria-checked:border-2 aria-checked:border-foreground aria-checked:bg-accent">
            <bdi>{w.name}</bdi> · {w.currency}
          </button>)}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <button type="button" aria-expanded={showDate} onClick={() => setShowDate((v) => !v)} className="flex min-h-12 items-center justify-between text-start text-sm text-muted-foreground">
          <span>{date === today ? t("today") : date}</span><ChevronDown aria-hidden className={cn("size-4 transition-transform",showDate && "rotate-180")} />
        </button>
        {showDate ? <label className="flex flex-col gap-1.5 text-sm font-medium">{t("date")}
          <input type="date" value={date} max={today} min="2000-01-01" onChange={(e) => setDate(e.target.value)}
            className="h-12 rounded-lg border border-input bg-card px-3.5 text-base font-normal" />
        </label> : null}
        <p className="text-[13px] text-muted-foreground">{t("paymentDateHelp")}</p>
      </div>
    </fieldset>
    {error ? <p role="alert" className="rounded-lg border border-border bg-secondary px-3.5 py-3 text-[15px]">{error}</p> : null}
    {blocked ? <Button type="button" variant="outline" onClick={() => { onClose(); router.refresh(); }}>{t("reviewLatest")}</Button>
      : <Button type="submit" variant="action" size="lg" className="w-full" disabled={pending || (!frozen && !canSave)}>
        {pending ? t("recording") : frozen ? t("retrySame") : t("record")}
      </Button>}
    <ConfirmSheet open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }}
      title={t("confirmAgainTitle")} confirmLabel={t("confirmAgain")} cancelLabel={t("cancel")}
      onConfirm={() => { if (confirmation) submit(confirmation); }} pending={pending}>
      <p>{t("confirmAgainBody")}</p>
      {confirmation ? <Amount minor={confirmation.amountMinor} currency={item.currency} className="text-xl font-semibold" /> : null}
    </ConfirmSheet>
  </form>;
}

export function InstallmentPaySheet({ state, onClose }: { state: InstallmentPayState | null; onClose: () => void }) {
  const t = useTranslations("Installments");
  const busy = useRef(false);
  return <SheetShell open={state !== null} onOpenChange={(open) => { if (!open && !busy.current) onClose(); }} title={state ? t("payTitle", { name: state.item.name }) : ""}>
    {state ? <Form key={state.requestId} state={state} onClose={onClose} onBusy={(value) => { busy.current = value; }} /> : null}
  </SheetShell>;
}
