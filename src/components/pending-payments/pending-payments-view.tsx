"use client";
import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { EmptyState } from "@/components/shell/empty-state";
import { deletePendingPayment } from "@/features/pending-payments/actions";
import { pendingErrorKey } from "@/features/pending-payments/errors";
import type { PendingPayment } from "@/features/pending-payments/schema";
import { todayIn } from "@/features/transactions/group";
import { CURRENCIES, sumMinor } from "@/lib/money";
import { Link, useRouter } from "@/i18n/navigation";
import { PaymentSheet } from "./payment-sheet";
import { ReceiptSheet } from "./receipt-sheet";

export function PendingPaymentsView({ payments }: { payments: PendingPayment[] }) {
  const t = useTranslations("PendingPayments");
  const locale = useLocale();
  const router = useRouter();
  const { timezone, walletById } = useAppData();
  const [sheet, setSheet] = useState<{ mode: "create" | "edit" | "receive" | "delete"; id?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const current = payments.find((payment) => payment.id === sheet?.id);
  const outstanding = payments.filter((payment) => payment.remainingMinor > 0);
  const completed = payments.filter((payment) => payment.remainingMinor === 0);
  const close = () => { setSheet(null); setDeleteError(null); };
  const formatDate = (date: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-LB-u-nu-latn" : "en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  const remove = () => {
    if (!current || pending) return;
    startTransition(async () => {
      try {
        const result = await deletePendingPayment(current.id, current.revision);
        if (!result.ok) { setDeleteError(t(pendingErrorKey(result.error))); return; }
        close(); toast(t("deleted")); router.refresh();
      } catch { setDeleteError(t("errorFailed")); }
    });
  };
  const rows = (items: PendingPayment[]) => <ul className="overflow-hidden rounded-xl border border-border bg-card">{items.map((item) => <li key={item.id} className="flex flex-col gap-3 border-b border-border p-3.5 last:border-b-0">
    <div>
      <h2 className="break-words text-[17px] font-semibold"><bdi>{item.project}</bdi></h2>
      <p className="break-words text-sm text-muted-foreground"><bdi>{item.client}</bdi></p>
      {item.remainingMinor === 0 ? <p className="mt-1 text-sm font-medium">{t("settled")}</p> : item.dueOn ? <p className="mt-1 text-sm font-medium">{t(item.dueOn < todayIn(timezone) ? "overdue" : "dueOn", { date: formatDate(item.dueOn) })}</p> : null}
    </div>
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm [&_dt]:break-words">
      <dt className="text-muted-foreground">{t("total")}</dt><dd><Amount minor={item.totalMinor} currency={item.currency} /></dd>
      <dt className="text-muted-foreground">{t("received")}</dt><dd><Amount minor={item.receivedMinor} currency={item.currency} /></dd>
      <dt className="font-semibold">{t("remaining")}</dt><dd className="font-semibold"><Amount minor={item.remainingMinor} currency={item.currency} /></dd>
    </dl>
    <div className="flex flex-wrap gap-2">
      {item.remainingMinor > 0 ? <Button onClick={() => setSheet({ mode: "receive", id: item.id })}>{t("receive")}</Button> : null}
      <Button variant="outline" onClick={() => setSheet({ mode: "edit", id: item.id })}>{t("edit")}</Button>
      {!item.hasReceiptHistory ? <Button variant="ghost" onClick={() => setSheet({ mode: "delete", id: item.id })}>{t("delete")}</Button> : null}
    </div>
    {item.receipts.length ? <details className="border-t border-border pt-1">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">{t("history")} ({item.receipts.length})</summary>
      <ul>{item.receipts.map((receipt) => <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-3 text-sm">
        <span className="min-w-0"><time dateTime={receipt.occurredOn}>{formatDate(receipt.occurredOn)}</time>{walletById(receipt.walletId) ? <bdi className="block break-words text-muted-foreground">{walletById(receipt.walletId)?.name}</bdi> : null}</span>
        <Amount minor={receipt.amountMinor} currency={item.currency} />
      </li>)}</ul>
      <p className="text-sm text-muted-foreground">{t("historyHelp")}</p>
      <Link href="/activity?kind=income" className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">{t("activity")}</Link>
    </details> : null}
  </li>)}</ul>;
  return <>
    <div className="flex flex-col gap-6">
      <Link href="/wallets" className="inline-flex min-h-11 items-center self-start text-sm text-primary underline underline-offset-4">{t("wallets")}</Link>
      <p className="text-[15px] text-muted-foreground">{t("help")}</p>
      {!payments.length ? <EmptyState title={t("emptyTitle")} body={t("emptyBody")} action={<Button onClick={() => setSheet({ mode: "create" })}><Plus aria-hidden />{t("add")}</Button>} /> : <>
        {outstanding.length ? <section aria-label={t("outstanding")} className="flex flex-col gap-2 border-b border-border pb-4">
          <h2 className="text-[17px] font-semibold">{t("outstanding")}</h2>
          {CURRENCIES.filter((currency) => outstanding.some((item) => item.currency === currency)).map((currency) => {
            let total: number;
            try { total = sumMinor(outstanding.filter((item) => item.currency === currency).map((item) => item.remainingMinor)); }
            catch { return <p key={currency} role="status" className="text-sm">{currency}: {t("totalsUnavailable")}</p>; }
            return <p key={currency} className="flex flex-wrap justify-between gap-2"><bdi>{currency}</bdi><Amount minor={total} currency={currency} className="font-semibold" /></p>;
          })}
        </section> : null}
        <Button variant="outline" className="self-start" onClick={() => setSheet({ mode: "create" })}><Plus aria-hidden />{t("add")}</Button>
        {outstanding.length ? rows(outstanding) : null}
        {completed.length ? <details><summary className="min-h-11 cursor-pointer py-3 text-[17px] font-semibold">{t("completed")} ({completed.length})</summary>{rows(completed)}</details> : null}
      </>}
    </div>
    {sheet?.mode === "create" ? <PaymentSheet item={null} onClose={close} /> : null}
    {current && sheet?.mode === "edit" ? <PaymentSheet key={current.id} item={current} onClose={close} /> : null}
    {current && sheet?.mode === "receive" ? <ReceiptSheet key={current.id} item={current} onClose={close} /> : null}
    {current && sheet?.mode === "delete" ? <ConfirmSheet open title={t("confirmDelete")} onOpenChange={(open) => !open && !pending && close()} confirmLabel={t("delete")} cancelLabel={t("cancel")} pending={pending} onConfirm={remove}>
      <p><bdi>{current.client} · {current.project}</bdi></p><p>{t("deleteHelp")}</p>{deleteError ? <p role="alert">{deleteError}</p> : null}
    </ConfirmSheet> : null}
  </>;
}
