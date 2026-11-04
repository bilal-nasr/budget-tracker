"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shell/empty-state";
import { summarizeLoans } from "@/features/loans/calculations";
import type { Loan } from "@/features/loans/schema";
import type { Currency } from "@/lib/money";
import { LoanSheet } from "./loan-sheet";
import { LoanDetailSheet } from "./loan-detail-sheet";
import { LoanPaymentSheet } from "./loan-payment-sheet";

export function LoansView({ loans, initialLoanId }: { loans: Loan[]; initialLoanId?: string }) {
  const t = useTranslations("Loans");
  const [sheet, setSheet] = useState<{ mode: "create" | "detail" | "edit" | "pay"; id?: string } | null>(initialLoanId ? { mode: "detail", id: initialLoanId } : null);
  const [showSettled, setShowSettled] = useState(false);
  const current = loans.find((loan) => loan.id === sheet?.id);
  const active = loans.filter((loan) => !loan.deletedAt && loan.remainingMinor > 0);
  const settled = loans.filter((loan) => loan.deletedAt || loan.remainingMinor === 0);
  const totals = summarizeLoans(loans);
  const close = () => setSheet(null);
  const row = (loan: Loan) => {
    const Icon = loan.direction === "borrowed" ? ArrowDownLeft : ArrowUpRight;
    return <li key={loan.id} className="border-b border-border last:border-b-0"><button type="button" onClick={() => setSheet({ mode: "detail", id: loan.id })}
      className="flex min-h-[72px] w-full flex-wrap items-center gap-3 px-3.5 py-3 text-start hover:bg-accent/50">
      <Icon aria-hidden className="size-5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1"><span className="block truncate font-medium"><bdi>{loan.name}</bdi></span><span className="text-[13px] text-muted-foreground">{t(loan.deletedAt ? "canceled" : loan.remainingMinor === 0 ? "settled" : loan.direction)}</span></span>
      <Amount minor={loan.remainingMinor} currency={loan.currency} className="text-[15px] font-semibold" />
    </button></li>;
  };
  return <>
    <div className="flex flex-col gap-6">
      {!loans.length ? <EmptyState title={t("emptyTitle")} body={t("emptyBody")} action={<Button onClick={() => setSheet({ mode: "create" })}><Plus aria-hidden />{t("add")}</Button>} /> : <>
        {!totals ? <p role="status">{t("totalsUnavailable")}</p> : <div className="flex flex-col gap-3 border-b border-border pb-4">
          {(Object.keys(totals) as Currency[]).filter((c) => loans.some((loan) => !loan.deletedAt && loan.currency === c)).map((currency) => <section key={currency} aria-label={currency} className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">{currency}</h2>
            <p className="flex flex-wrap justify-between gap-2 text-[15px]"><span>{t("owed")}</span><Amount minor={totals[currency].owedMinor} currency={currency} /></p>
            <p className="flex flex-wrap justify-between gap-2 text-[15px]"><span>{t("receivable")}</span><Amount minor={totals[currency].receivableMinor} currency={currency} /></p>
          </section>)}
        </div>}
        <Button variant="outline" className="self-start" onClick={() => setSheet({ mode: "create" })}><Plus aria-hidden />{t("add")}</Button>
        {active.length ? <ul className="overflow-hidden rounded-xl border border-border bg-card">{active.map(row)}</ul> : null}
        {settled.length ? <section><button type="button" aria-expanded={showSettled} onClick={() => setShowSettled(!showSettled)} className="min-h-11 text-sm font-medium underline underline-offset-4">{t("showSettled")} ({settled.length})</button>
          {showSettled ? <ul className="overflow-hidden rounded-xl border border-border bg-card">{settled.map(row)}</ul> : null}
        </section> : null}
      </>}
    </div>
    {sheet?.mode === "create" ? <LoanSheet item={null} onClose={close} /> : null}
    {current && sheet?.mode === "edit" ? <LoanSheet key={current.id} item={current} onClose={() => setSheet({ mode: "detail", id: current.id })} /> : null}
    {current && sheet?.mode === "detail" ? <LoanDetailSheet key={`${current.id}:${current.remainingMinor}:${current.livePaymentCount}:${current.latestLivePayment?.transactionId}:${current.latestLivePayment?.revision}:${current.archivedAt}:${current.deletedAt}`} item={current} onClose={close} onEdit={() => setSheet({ mode: "edit", id: current.id })} onPay={() => setSheet({ mode: "pay", id: current.id })} /> : null}
    {current && sheet?.mode === "pay" ? <LoanPaymentSheet item={current} onClose={() => setSheet({ mode: "detail", id: current.id })} /> : null}
  </>;
}
