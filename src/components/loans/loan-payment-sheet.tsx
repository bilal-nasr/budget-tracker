"use client";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { allocateRepayment, suggestLoanPayment } from "@/features/loans/calculations";
import { recordLoanPayment, voidLoanPayment } from "@/features/loans/actions";
import { loanPaymentSchema, type Loan, type LoanPaymentInput } from "@/features/loans/schema";
import { useRouter } from "@/i18n/navigation";
import { useLoanSubmission } from "./use-loan-submission";
import { loanErrorKey } from "@/features/loans/errors";
import { todayIn } from "@/features/transactions/group";
import { CURRENCY_DECIMALS, parseAmount, toInputText } from "@/lib/money";

export function LoanPaymentSheet({ item, onClose }: { item: Loan; onClose: () => void }) {
  const t = useTranslations("Loans");
  const router = useRouter();
  const { legacyWallets: wallets, timezone } = useAppData();
  const usable = wallets.filter((w) => !w.archived && w.currency === item.currency);
  const [requestId] = useState(() => crypto.randomUUID());
  const formId = useId();
  const [walletId, setWalletId] = useState(usable.find((w) => w.id === item.walletId)?.id ?? usable[0]?.id ?? "");
  const suggested = suggestLoanPayment(item.remainingMinor, item.monthlyPaymentMinor, item.finalPaymentMinor);
  const [text, setText] = useState(toInputText(suggested?.amountMinor ?? item.remainingMinor, item.currency));
  const [date, setDate] = useState(todayIn(timezone));
  const submission = useLoanSubmission<LoanPaymentInput, { id: string; revision: number }>(recordLoanPayment, (result) => {
    onClose();
    toast(t("recorded"), { action: { label: t("undo"), onClick: async () => {
      const undone = await voidLoanPayment(result.id, result.revision);
      if (!undone.ok) toast.error(t(loanErrorKey(undone.error)));
    } } });
  });
  const minor = parseAmount(text, item.currency);
  const split = minor === null ? null : allocateRepayment(minor, item.principalRemainingMinor, item.feeRemainingMinor);
  const latestDate = item.latestPaymentOn ?? item.events.filter((e) => e.event === "repayment" && e.deletedAt === null).reduce((d, e) => e.occurredOn > d ? e.occurredOn : d, item.openedOn);
  const input = loanPaymentSchema.safeParse({ requestId, loanId: item.id, walletId, amountMinor: minor, occurredOn: date });
  const valid = split !== null && input.success && date >= latestDate && date <= todayIn(timezone) && item.deletedAt === null && usable.some((w) => w.id === walletId);
  const submit = () => {
    submission.submit(valid && input.success ? input.data : null);
  };
  return <SheetShell open dismissible={submission.dismissible} onOpenChange={(open) => !open && submission.dismissible && onClose()} title={t(item.direction === "borrowed" ? "record" : "receive")}
    description={<bdi>{item.name}</bdi>} footer={submission.review ? <Button className="w-full" onClick={() => { onClose(); router.refresh(); }}>{t("reviewLatest")}</Button>
      : <Button form={formId} type="submit" size="lg" variant="action" className="w-full" disabled={submission.pending || (!submission.uncertain && !valid)}>{t(submission.uncertain ? "retrySame" : "recordPayment")}</Button>}>
    <form id={formId} onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-4" noValidate>
      <fieldset disabled={submission.frozen} className="flex min-w-0 flex-col gap-4 border-0 p-0">
      <p className="text-sm text-muted-foreground">{t("splitHelp")}</p>
      {item.monthlyPaymentMinor !== null ? <p className="text-sm text-muted-foreground">{t(suggested?.isFinal ? "suggestFinal" : "suggestMonthly")}</p> : null}
      <TextField label={t("amount")} value={text} onChange={(e) => setText(e.target.value)} dir="ltr" inputMode={CURRENCY_DECIMALS[item.currency] === 0 ? "numeric" : "decimal"}
        error={minor !== null && minor > item.remainingMinor ? t("tooMuch") : text.trim() && (minor === null || minor === 0) ? t("invalidAmount") : null} />
      <fieldset className="flex flex-col gap-2"><legend className="mb-2 text-sm font-medium">{t("wallet")}</legend>
        {!usable.length ? <p role="status" className="text-sm">{t("noMatchingWallet")}</p> : usable.map((w) => <label key={w.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 py-2">
          <input type="radio" name={`${formId}-wallet`} checked={walletId === w.id} onChange={() => setWalletId(w.id)} /><bdi>{w.name}</bdi> · {w.currency}
        </label>)}
      </fieldset>
      <TextField label={t("paymentDate")} type="date" min={latestDate} max={todayIn(timezone)} value={date} onChange={(e) => setDate(e.target.value)} />
      {split ? <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-y border-border py-3 text-sm">
        <dt>{t("principalPart")}</dt><dd><Amount minor={split.principalMinor} currency={item.currency} /></dd>
        <dt>{t("feePart")}</dt><dd><Amount minor={split.feeMinor} currency={item.currency} /></dd>
        <dt className="font-semibold">{t("leftAfter")}</dt><dd><Amount minor={item.remainingMinor - (minor ?? 0)} currency={item.currency} /></dd>
      </dl> : null}
      </fieldset>
      {submission.error ? <p role="alert" className="text-sm">{t(submission.uncertain ? "errorUncertain" : loanErrorKey(submission.error))}</p> : null}
    </form>
  </SheetShell>;
}
