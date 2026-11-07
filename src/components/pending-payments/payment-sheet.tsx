"use client";
import { currencyIntent } from "@/lib/currency-intent";
import { useRuntimeBalances, useMoneyDraftUnit } from "@/components/add/runtime-balances";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { useLoanSubmission } from "@/components/loans/use-loan-submission";
import { createPendingPayment, updatePendingPayment } from "@/features/pending-payments/actions";
import { pendingPaymentSchema, type PendingPayment, type PendingPaymentInput } from "@/features/pending-payments/schema";
import { pendingErrorKey } from "@/features/pending-payments/errors";
import { parseAmount, toInputText } from "@/lib/money";
import { useRouter } from "@/i18n/navigation";

export function PaymentSheet({ item, onClose }: { item: PendingPayment | null; onClose: () => void }) {
  const t = useTranslations("PendingPayments");
  const router = useRouter();
  const { definition, currencyByCode, enabledCurrencies } = useRuntimeBalances();
  const tCurrency = useTranslations("Currencies");
  const formId = useId();
  const [requestId] = useState(() => crypto.randomUUID());
  const [client, setClient] = useState(item?.client ?? "");
  const [project, setProject] = useState(item?.project ?? "");
  const [currency, setCurrency] = useState(item?.currency ?? enabledCurrencies[0]?.code ?? "");
  const [text, setText] = useState(item ? toInputText(item.totalMinor, definition(item.currency)) : "");
  const [dueOn, setDueOn] = useState(item?.dueOn ?? "");
  const submission = useLoanSubmission<PendingPaymentInput, object>(
    (input) => item ? updatePendingPayment(item.id, item.revision, input) : createPendingPayment(input),
    () => { onClose(); toast(t("saved")); },
  );
  const unit = item ? definition(item.currency) : currencyByCode(currency);
  useMoneyDraftUnit(unit, () => { setText(""); }, !!unit && !unit.disabled);
  const minor = unit ? parseAmount(text, unit) : null;
  const parsed = pendingPaymentSchema.safeParse({ expectedUnits: currencyIntent(unit), requestId, client, project, currency, totalMinor: minor, dueOn: dueOn || null });
  const belowPaid = minor !== null && minor < (item?.receivedMinor ?? 0);
  const valid = !!unit && !unit.disabled && parsed.success && !belowPaid;
  return <SheetShell open dismissible={submission.dismissible} onOpenChange={(open) => !open && onClose()} title={t(item ? "edit" : "add")}
    footer={submission.review ? <Button className="w-full" onClick={() => { onClose(); router.refresh(); }}>{t("review")}</Button> :
      <Button variant="action" size="lg" className="w-full" form={formId} type="submit" loading={submission.pending} disabled={!submission.uncertain && !valid}>{t(submission.uncertain ? "retrySame" : "save")}</Button>}>
    <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); submission.submit(valid && parsed.success ? parsed.data : null); }} className="flex flex-col gap-4">
      <fieldset disabled={submission.frozen} className="flex min-w-0 flex-col gap-4 border-0 p-0">
        <TextField label={t("client")} value={client} onChange={(event) => setClient(event.target.value)} maxLength={60} autoComplete="organization" required />
        <TextField label={t("project")} value={project} onChange={(event) => setProject(event.target.value)} maxLength={60} required />
        <fieldset className="flex flex-wrap gap-2"><legend className="mb-2 text-sm font-medium">{t("currency")}</legend>
          {(item ? [definition(item.currency)] : enabledCurrencies).map(({code: value}) => <label key={value} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3">
            <input type="radio" name={`${formId}-currency`} value={value} checked={value === currency} disabled={!!item} onChange={() => { setCurrency(value); setText(""); }} /><bdi>{value}</bdi>
          </label>)}
        </fieldset>
        {item ? <p className="text-sm text-muted-foreground">{t("currencyLocked")}</p> : null}
        {!unit ? <p role="status">{tCurrency("draftUnavailable")}</p> : null}
        <TextField disabled={!unit} label={`${t("total")} (${currency})`} value={text} onChange={(event) => setText(event.target.value)} inputMode={unit?.decimalPlaces ? "decimal" : "numeric"}
          error={belowPaid ? t("errorBelowPaid") : text.trim() && (!minor || minor < 1) ? t("errorInvalid") : null} required />
        <TextField label={t("due")} type="date" min="2000-01-01" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
      </fieldset>
      {submission.error ? <p role="alert" className="text-sm">{t(submission.uncertain ? "errorUncertain" : pendingErrorKey(submission.error))}</p> : null}
    </form>
  </SheetShell>;
}
