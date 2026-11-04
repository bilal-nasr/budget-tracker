"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { loadPendingReceipts } from "@/features/pending-payments/history-actions";
import type { PendingPayment, PendingReceipt } from "@/features/pending-payments/schema";
import { Link } from "@/i18n/navigation";

/**
 * Receipts load when the history is first opened, so the list never downloads
 * every receipt ever recorded. The parent keys this by job, revision and
 * received amount, so a new or deleted receipt resets it.
 */
export function PendingReceiptHistory({ item, formatDate }: { item: PendingPayment; formatDate: (date: string) => string }) {
  const t = useTranslations("PendingPayments");
  const { walletById } = useAppData();
  const [receipts, setReceipts] = useState<PendingReceipt[] | null>(null);
  const [failed, setFailed] = useState(false);
  const loading = useRef(false);
  const load = () => {
    if (loading.current || receipts) return;
    loading.current = true;
    setFailed(false);
    loadPendingReceipts(item.id).then(setReceipts).catch(() => setFailed(true)).finally(() => { loading.current = false; });
  };
  return <details className="border-t border-border pt-1" onToggle={(event) => { if (event.currentTarget.open) load(); }}>
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">{t("history")}{receipts ? ` (${receipts.length})` : null}</summary>
    {receipts ? <ul>{receipts.map((receipt) => <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-3 text-sm">
      <span className="min-w-0"><time dateTime={receipt.occurredOn}>{formatDate(receipt.occurredOn)}</time>{walletById(receipt.walletId) ? <bdi className="block break-words text-muted-foreground">{walletById(receipt.walletId)?.name}</bdi> : null}</span>
      <Amount minor={receipt.amountMinor} currency={item.currency} />
    </li>)}</ul> : failed ? <div role="alert" className="flex flex-wrap items-center gap-2 border-t border-border py-3 text-sm">
      {t("historyUnavailable")}<Button variant="outline" onClick={load}>{t("retry")}</Button>
    </div> : <div aria-hidden className="flex flex-col border-t border-border py-3"><Skeleton className="h-[42px] w-full" /></div>}
    <p className="text-sm text-muted-foreground">{t("historyHelp")}</p>
    <Link href="/activity?kind=income" className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">{t("activity")}</Link>
  </details>;
}
