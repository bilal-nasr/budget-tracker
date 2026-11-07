"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { loadInstallmentHistory, type InstallmentHistoryPage } from "@/features/installments/history-actions";
import type { Installment } from "@/features/installments/schema";
import { useRuntimeBalances } from "@/components/add/runtime-balances";
import { useComposer } from "@/components/shell/composer";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";

export function InstallmentHistory({ item, onClose }: { item: Installment; onClose: () => void }) {
  const t = useTranslations("Installments");
  const ta = useTranslations("Activity");
  const locale = useLocale();
  const { balanceChoiceById } = useRuntimeBalances();
  const { openDetail } = useComposer();
  const [page, setPage] = useState<InstallmentHistoryPage | null>(() => item.historyComplete === false ? null : {
    rows: item.payments.flatMap((p) => p.transaction ? [p.transaction] : []), next: null,
  });
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (item.historyComplete !== false) return;
    let active = true;
    loadInstallmentHistory(item.id, null).then((result) => { if (active) setPage(result); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [item.id, item.historyComplete]);
  const loadMore = () => startTransition(async () => {
    setFailed(false);
    try {
      const result = await loadInstallmentHistory(item.id, page?.next ?? null);
      setPage((previous) => ({ rows: [...(previous?.rows ?? []), ...result.rows], next: result.next }));
    } catch { setFailed(true); }
  });
  const date = new Intl.DateTimeFormat(locale === "ar" ? "ar-LB-u-nu-latn" : "en-US", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
  return <section aria-labelledby="in-history" className="flex flex-col gap-1 border-t border-border pt-4">
    <h3 id="in-history" className="text-sm font-medium">{t("history")}</h3>
    {!page && !failed ? <div className="h-24 animate-pulse rounded-lg bg-accent" /> : null}
    {page?.rows.length === 0 && item.paidBeforeMinor === 0 ? <p className="text-[15px] text-muted-foreground">{t("historyEmpty")}</p> : null}
    <ul className="flex flex-col">
      {page?.rows.map((transaction) => <li key={transaction.id} className="border-b border-border last:border-b-0">
        <button type="button" onClick={() => { onClose(); openDetail(transaction); }}
          className="flex min-h-12 w-full items-center justify-between gap-3 text-start">
          <span className="min-w-0 truncate text-[15px]">{date.format(new Date(`${transaction.occurredOn}T00:00:00Z`))} · <bdi>{balanceChoiceById(transaction.balanceId)?.name}</bdi></span>
          <Amount minor={transaction.amountMinor} currency={item.currency} className="shrink-0 font-semibold" />
        </button>
      </li>)}
      {item.paidBeforeMinor > 0 ? <li className="flex min-h-12 items-center justify-between gap-3 text-[15px] text-muted-foreground">
        <span>{t("beforeApp")}</span><Amount minor={item.paidBeforeMinor} currency={item.currency} className="shrink-0" />
      </li> : null}
    </ul>
    {failed ? <p role="alert" className="text-sm text-over">{ta("loadFailed")}</p> : null}
    {failed || page?.next ? <Button type="button" variant="outline" loading={pending} onClick={loadMore}>{ta("loadMore")}</Button> : null}
  </section>;
}
