"use client";

import { useTranslations } from "next-intl";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { useComposer } from "@/components/shell/composer";
import { EmptyState } from "@/components/shell/empty-state";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { FixedCard } from "@/components/fixed/fixed-card";
import { SalaryCard } from "@/components/salary/salary-card";
import { CycleLoadError } from "@/components/installments/cycle-load-error";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { FixedExpense } from "@/features/fixed/schema";
import type { Installment } from "@/features/installments/schema";
import type { MonthBudgets } from "@/features/budgets/schema";
import { isOver } from "@/features/budgets/rows";
import type { SalaryStatus } from "@/features/salary/schema";
import type { Transaction } from "@/features/transactions/schema";
import { totalsByCurrency } from "@/features/wallets/totals";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { CURRENCIES, formatAmount } from "@/lib/money";

export function HomeView({ recent, commitments, budgetSummary }: {
  recent: React.ReactNode;
  commitments: React.ReactNode;
  budgetSummary: React.ReactNode;
}) {
  const t = useTranslations("Home");
  const { wallets } = useAppData();
  const { openWallet } = useComposer();
  const active = wallets.filter((w) => !w.archived);
  const hasArchived = wallets.some((w) => w.archived);
  const totals = totalsByCurrency(active);
  const held = CURRENCIES.filter((currency) => active.some((wallet) => wallet.currency === currency));

  return (
    <>
      <ScreenHeader>
        <p className="text-[15px] text-shell-muted">{t("leadLabel")}</p>
        {active.length === 0 ? (
          <h1 className="mt-1 text-[28px] leading-tight font-bold tracking-tight">{t("leadEmpty")}</h1>
        ) : (
          <>
            <h1 className="sr-only">{t("leadLabel")}</h1>
            {held.map((currency, index) => (
              <p key={currency} className={cn("font-bold tracking-tight", formatAmount(totals[currency], currency).length > 23 ? "mt-2 text-base leading-tight" : formatAmount(totals[currency], currency).length > 16 ? "mt-2 text-xl leading-tight" : index > 0 ? "mt-3 text-[28px] leading-tight" : "mt-1 text-[40px] leading-[1.1]")}>
                <Amount minor={totals[currency]} currency={currency} />
              </p>
            ))}
            {budgetSummary}
          </>
        )}
      </ScreenHeader>
      <PageBody>
        {active.length === 0 ? (
          <EmptyState
            title={t("emptyTitle")}
            body={t("emptyBody")}
            action={
              <div className="flex flex-col items-center gap-1">
                <Button onClick={() => openWallet(null)}>{t("emptyAction")}</Button>
                {hasArchived ? (
                  <Link href="/wallets" className="inline-flex min-h-11 items-center text-[14px] text-primary underline underline-offset-4">
                    {t("restoreArchived")}
                  </Link>
                ) : null}
              </div>
            }
          />
        ) : (
          <>
            {commitments}
            {recent}
          </>
        )}
      </PageBody>
    </>
  );
}

function HomeWallets() {
  const t = useTranslations("Home");
  const { wallets } = useAppData();
  const active = wallets.filter((w) => !w.archived);

  return (
    <section aria-labelledby="h-wallets" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 id="h-wallets" className="text-[17px] font-semibold">{t("wallets")}</h2>
        <Link href="/wallets" className="inline-flex min-h-11 items-center text-[14px] text-muted-foreground underline underline-offset-4">
          {t("manage")}
        </Link>
      </div>
      <div className="-mx-4 flex snap-x snap-mandatory scroll-ps-4 gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {active.map((w) => (
          <Link
            key={w.id}
            href={{ pathname: "/activity", query: { walletId: w.id } }}
            className="min-h-[72px] min-w-[140px] snap-start rounded-xl border border-border bg-card px-3.5 py-3"
          >
            <span className="block truncate text-[13px] text-muted-foreground">
              <bdi>{w.name}</bdi> · {w.currency}
            </span>
            <Amount minor={w.balanceMinor} currency={w.currency} className="text-lg font-semibold" />
          </Link>
        ))}
      </div>
    </section>
  );
}

export function HomeBudgetSummary({ budgets }: { budgets: MonthBudgets[] }) {
  const t = useTranslations("Home");
  const tb = useTranslations("Budgets");
  const overCount = budgets.reduce((n, b) => n + b.rows.filter(isOver).length, 0);
  return <>
    {budgets.length > 0 ? (
      <div className="mt-3 flex flex-col gap-1 text-[15px]">
        {budgets.map((b) => {
          const left = b.totalLimitMinor - b.totalSpentMinor;
          return (
            <p key={b.currency} className="text-shell-muted">
              {left >= 0 ? t("leftToSpend") : t("overBudget")}{" "}
              <Amount minor={Math.abs(left)} currency={b.currency} className="font-semibold text-shell-foreground" />
            </p>
          );
        })}
        {overCount > 0 ? (
          <Link href="/budgets" className="inline-flex min-h-11 items-center gap-2 font-medium text-shell-foreground underline underline-offset-4">
            <TriangleAlert aria-hidden className="size-4" />
            {tb("overCount", { count: overCount })}
          </Link>
        ) : null}
      </div>
    ) : null}
  </>;
}

export function HomeCommitments({ salaryStatus, fixed, installments, cycleUnavailable }: {
  salaryStatus: SalaryStatus; fixed: FixedExpense[]; installments: Installment[]; cycleUnavailable: boolean;
}) {
  return <>
    {cycleUnavailable ? <CycleLoadError /> : <>
      <SalaryCard status={salaryStatus} />
    </>}
    <HomeWallets />
    {!cycleUnavailable && <FixedCard items={fixed} installments={installments} />}
  </>;
}

export function HomeRecent({ recent }: { recent: Transaction[] }) {
  const t = useTranslations("Home");
  const { openDetail, openAdd } = useComposer();
  return <>
    <section aria-labelledby="h-recent" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 id="h-recent" className="text-[17px] font-semibold">{t("recent")}</h2>
        <Link href="/activity" className="inline-flex min-h-11 items-center text-[14px] text-muted-foreground underline underline-offset-4">
          {t("seeAll")}
        </Link>
      </div>
      {recent.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4">
          <p className="text-[15px] text-muted-foreground">{t("noActivity")}</p>
          <Button onClick={() => openAdd()}>{t("logFirst")}</Button>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {recent.map((row) => (
            <TransactionRow key={row.id} transaction={row} onOpen={openDetail} />
          ))}
        </ul>
      )}
    </section>
  </>;
}
