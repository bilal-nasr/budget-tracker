"use client";
import { useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Amount } from "@/components/money/amount";
import { useRuntimeBalances } from "@/components/add/runtime-balances";
import { Button } from "@/components/ui/button";
import { SelectionBar, SelectionCheck, SelectToggle } from "@/components/selection/selection-bar";
import { useSelection } from "@/components/selection/use-selection";
import { EmptyState } from "@/components/shell/empty-state";
import { deletePendingPayment } from "@/features/pending-payments/actions";
import { pendingErrorKey } from "@/features/pending-payments/errors";
import type { PendingPayment } from "@/features/pending-payments/schema";
import { todayIn } from "@/features/transactions/group";
import { sumMinor } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { PendingReceiptHistory } from "./pending-receipt-history";

// Sheets load on first open; the list renders without their code.
const PaymentSheet = dynamic(() => import("./payment-sheet").then((m) => m.PaymentSheet));
const ReceiptSheet = dynamic(() => import("./receipt-sheet").then((m) => m.ReceiptSheet));
const ConfirmSheet = dynamic(() => import("@/components/ui/confirm-sheet").then((m) => m.ConfirmSheet));
const BulkDeleteSheet = dynamic(() => import("./bulk-delete-sheet").then((m) => m.BulkDeleteSheet));

export function PendingPaymentsView({ payments }: { payments: PendingPayment[] }) {
  const t = useTranslations("PendingPayments");
  const locale = useLocale();
  const { timezone, currencies } = useRuntimeBalances();
  const [sheet, setSheet] = useState<{ mode: "create" | "edit" | "receive" | "delete"; id?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const current = payments.find((payment) => payment.id === sheet?.id);
  const outstanding = payments.filter((payment) => payment.remainingMinor > 0);
  const completed = payments.filter((payment) => payment.remainingMinor === 0);
  const close = () => { setSheet(null); setDeleteError(null); };

  // Select mode: only jobs that never received money can be deleted, so only those can be ticked.
  const deletableIds = useMemo(() => payments.filter((payment) => !payment.hasReceiptHistory).map((payment) => payment.id), [payments]);
  const selection = useSelection(deletableIds);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const selectedItems = payments.filter((payment) => selection.picked.has(payment.id)).map((payment) => ({ id: payment.id, revision: payment.revision }));
  const selectRows = (items: PendingPayment[]) => <ul className="overflow-hidden rounded-xl border border-border bg-card">{items.map((item) => {
    const selected = selection.isPicked(item.id);
    const locked = item.hasReceiptHistory;
    return <li key={item.id} className="border-b border-border last:border-b-0">
      <button type="button" role="checkbox" aria-checked={selected} aria-disabled={locked || undefined} disabled={pending}
        onClick={() => { if (!locked) selection.toggle(item.id); }}
        className={cn("flex min-h-16 w-full items-center gap-3 px-3.5 py-2.5 text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          locked ? "cursor-default" : "hover:bg-accent/50 active:bg-accent", selected && "bg-accent/60")}>
        <SelectionCheck selected={selected} disabled={locked} />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-medium", locked && "text-muted-foreground")}><bdi>{item.project}</bdi></span>
          <span className="block truncate text-[13px] text-muted-foreground">{locked ? t("hasReceipts") : <bdi>{item.client}</bdi>}</span>
        </span>
        <Amount minor={item.remainingMinor} currency={item.currency} className={cn("shrink-0 font-semibold", locked && "text-muted-foreground")} />
      </button>
    </li>;
  })}</ul>;
  const formatDate = (date: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-LB-u-nu-latn" : "en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  const remove = () => {
    if (!current || pending) return;
    startTransition(async () => {
      try {
        const result = await deletePendingPayment(current.id, current.revision);
        if (!result.ok) { setDeleteError(t(pendingErrorKey(result.error))); return; }
        close(); toast(t("deleted"));
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
    {item.receivedMinor > 0 ? <PendingReceiptHistory key={`${item.id}:${item.revision}:${item.receivedMinor}`} item={item} formatDate={formatDate} /> : null}
  </li>)}</ul>;
  return <>
    <div className="flex flex-col gap-6">
      <Link href="/wallets" className="inline-flex min-h-11 items-center self-start text-sm text-primary underline underline-offset-4">{t("wallets")}</Link>
      <p className="text-[15px] text-muted-foreground">{t("help")}</p>
      {!payments.length ? <EmptyState title={t("emptyTitle")} body={t("emptyBody")} action={<Button onClick={() => setSheet({ mode: "create" })}><Plus aria-hidden />{t("add")}</Button>} /> : <>
        {outstanding.length ? <section aria-label={t("outstanding")} className="flex flex-col gap-2 border-b border-border pb-4">
          <h2 className="text-[17px] font-semibold">{t("outstanding")}</h2>
          {currencies.map((currency) => currency.code).filter((currency) => outstanding.some((item) => item.currency === currency)).map((currency) => {
            let total: number;
            try { total = sumMinor(outstanding.filter((item) => item.currency === currency).map((item) => item.remainingMinor)); }
            catch { return <p key={currency} role="status" className="text-sm">{currency}: {t("totalsUnavailable")}</p>; }
            return <p key={currency} className="flex flex-wrap justify-between gap-2"><bdi>{currency}</bdi><Amount minor={total} currency={currency} className="font-semibold" /></p>;
          })}
        </section> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={selection.selecting} onClick={() => setSheet({ mode: "create" })}><Plus aria-hidden />{t("add")}</Button>
          {deletableIds.length > 1 ? <SelectToggle selecting={selection.selecting} label={t("select")} disabled={pending}
            onToggle={() => (selection.selecting ? selection.stop() : selection.start())} /> : null}
        </div>
        {selection.selecting ? <p className="text-sm text-muted-foreground">{t("selectHelp")}</p> : null}
        {selection.selecting ? selectRows(outstanding) : outstanding.length ? rows(outstanding) : null}
        {selection.selecting ? <SelectionBar label={t("selectionLabel")} count={selection.count} allPicked={selection.allPicked} onToggleAll={selection.toggleAll} onDone={selection.stop}>
          <Button variant="destructive" disabled={selection.count === 0 || pending} onClick={() => setBulkConfirm(true)}><Trash2 aria-hidden />{t("bulkDelete")}</Button>
        </SelectionBar> : null}
        {completed.length && !selection.selecting ? <details><summary className="min-h-11 cursor-pointer py-3 text-[17px] font-semibold">{t("completed")} ({completed.length})</summary>{rows(completed)}</details> : null}
      </>}
    </div>
    {sheet?.mode === "create" ? <PaymentSheet item={null} onClose={close} /> : null}
    {current && sheet?.mode === "edit" ? <PaymentSheet key={current.id} item={current} onClose={close} /> : null}
    {current && sheet?.mode === "receive" ? <ReceiptSheet key={current.id} item={current} onClose={close} /> : null}
    {current && sheet?.mode === "delete" ? <ConfirmSheet open title={t("confirmDelete")} onOpenChange={(open) => !open && !pending && close()} confirmLabel={t("delete")} cancelLabel={t("cancel")} pending={pending} onConfirm={remove}>
      <p><bdi>{current.client} · {current.project}</bdi></p><p>{t("deleteHelp")}</p>{deleteError ? <p role="alert">{deleteError}</p> : null}
    </ConfirmSheet> : null}
    {bulkConfirm ? <BulkDeleteSheet items={selectedItems} onClose={() => setBulkConfirm(false)} onDeleted={() => { setBulkConfirm(false); selection.stop(); }} /> : null}
  </>;
}
