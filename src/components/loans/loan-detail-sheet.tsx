"use client";
import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { TileBar } from "@/components/budget/tile-bar";
import { cancelLoan, restoreLoanPayment, setLoanArchived, voidLoanPayment, type LoanActionResult } from "@/features/loans/actions";
import { loanErrorKey } from "@/features/loans/errors";
import type { Loan } from "@/features/loans/schema";
import { percentInput } from "@/features/loans/calculations";

export function LoanDetailSheet({ item, onClose, onEdit, onPay }: { item: Loan; onClose: () => void; onEdit: () => void; onPay: () => void }) {
  const t = useTranslations("Loans");
  const locale = useLocale();
  const { walletById } = useAppData();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "cancel" } | { kind: "void"; transactionId: string; revision: number } | null>(null);
  const live = item.events.filter((e) => e.event === "repayment" && e.deletedAt === null);
  const latest = live.reduce<(typeof live)[number] | null>((last, e) => !last || e.sequence > last.sequence ? e : last, null);
  const run = (operation: () => Promise<LoanActionResult>) => {
    setError(null);
    startTransition(async () => {
      const result = await operation();
      if (!result.ok) { setError(t(loanErrorKey(result.error))); return; }
      setConfirm(null);
    });
  };
  const date = (value: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  const money = (value: number) => <Amount minor={value} currency={item.currency} />;
  return <>
    <SheetShell open onOpenChange={(open) => !open && onClose()} title={<bdi>{item.name}</bdi>} description={t(item.direction)}
      footer={!item.deletedAt && item.remainingMinor > 0 ? <Button variant="action" size="lg" className="w-full" onClick={onPay}>{t(item.direction === "borrowed" ? "record" : "receive")}</Button> : undefined}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2"><p className="text-sm text-muted-foreground">{t(item.deletedAt ? "canceled" : item.remainingMinor === 0 ? "settled" : "remaining")}</p>
          <p className="text-[28px] font-semibold">{money(item.remainingMinor)}</p>
          <TileBar value={(item.totalDueMinor - item.remainingMinor) / item.totalDueMinor} label={t("principalPaid")} />
        </div>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t("percent")}</dt><dd className="text-end"><bdi dir="ltr">{percentInput(item.feeBps)}%</bdi></dd>
          {([
            ["principal", item.principalMinor], ["fee", item.feeMinor], ["total", item.totalDueMinor],
            ["principalBefore", item.principalPaidBeforeMinor], ["feeBefore", item.feePaidBeforeMinor],
            ["principalPaid", item.principalPaidMinor], ["feePaid", item.feePaidMinor],
            ["principalLeft", item.principalRemainingMinor], ["feeLeft", item.feeRemainingMinor],
          ] as const).map(([label, value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{t(label)}</dt><dd className="text-end">{money(value)}</dd></div>)}
        </dl>
        <section aria-label={t("history")} className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold">{t("history")}</h2>
          {!item.events.length ? <p className="text-sm text-muted-foreground">{t("noHistory")}</p> : <ol className="divide-y divide-border">
            {item.events.map((event) => <li key={event.transactionId} className="flex flex-col gap-1 py-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2"><span>{date(event.occurredOn)} · {t(event.event)}</span><Amount minor={event.flow === "in" ? event.amountMinor : -event.amountMinor} currency={item.currency} sign /></div>
              <p className="text-muted-foreground"><bdi>{walletById(event.walletId)?.name}</bdi>{event.deletedAt ? <> · {t("voided")}</> : null}</p>
              {event.event === "repayment" ? <p className="flex flex-wrap gap-x-3 text-muted-foreground"><span>{t("principalPart")} {money(event.principalMinor)}</span><span>{t("feePart")} {money(event.feeMinor)}</span></p> : null}
              {event.deletedAt && event.event === "repayment" && !item.deletedAt && !live.some((e) => e.sequence > event.sequence) ? <Button variant="outline" disabled={pending} onClick={() => run(() => restoreLoanPayment(event.transactionId, event.revision))}>{t("restore")}</Button> : null}
            </li>)}
          </ol>}
        </section>
        {error ? <p role="alert" className="text-sm">{error}</p> : null}
        {!item.deletedAt ? <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={onEdit}>{t("edit")}</Button>
          {latest ? <Button variant="outline" onClick={() => setConfirm({ kind: "void", transactionId: latest.transactionId, revision: latest.revision })} disabled={pending}>{t("void")}</Button> : null}
          {item.remainingMinor === 0 ? <Button variant="outline" disabled={pending} onClick={() => run(() => setLoanArchived(item.id, !item.archivedAt))}>{t(item.archivedAt ? "unarchive" : "archive")}</Button> : null}
          {!live.length ? <Button variant="outline" disabled={pending} onClick={() => setConfirm({ kind: "cancel" })}>{t("cancelLoan")}</Button> : null}
        </div> : null}
      </div>
    </SheetShell>
    <ConfirmSheet open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)} title={t(confirm?.kind === "void" ? "voidTitle" : "cancelTitle")}
      confirmLabel={t(confirm?.kind === "void" ? "void" : "cancelLoan")} cancelLabel={t("cancel")} pending={pending}
      onConfirm={() => run(() => confirm?.kind === "void" ? voidLoanPayment(confirm.transactionId, confirm.revision) : cancelLoan(item.id))}>
      <p>{t(confirm?.kind === "void" ? "voidHelp" : item.creationMode === "new" ? "cancelNewHelp" : "cancelExistingHelp")}</p>
      {error ? <p role="alert">{error}</p> : null}
    </ConfirmSheet>
  </>;
}
