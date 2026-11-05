"use client";
import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { Amount } from "@/components/money/amount";
import { settlementRateText } from "@/features/transactions/settlement";
import type { SettlementSnapshot } from "@/features/transactions/settlement-serialization";

export function CashSettlementSummary({ settlement, costMinor, currency, changeWalletNames = [] }: {
  settlement: SettlementSnapshot; costMinor: number; currency: string; changeWalletNames?: readonly (string | undefined)[];
}) {
  const t = useTranslations("Cashier");
  const row = "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1";
  const hasHistoricalRate = settlement.changes.some((change) => change.rate);
  return <section aria-label={t("summary")} className="flex min-w-0 flex-col gap-3 border-t border-border pt-4">
    <h3 className="text-[17px] font-semibold">{t("summary")}</h3>
    <dl className="flex min-w-0 flex-col gap-2.5 text-[15px]">
      <div className={row}><dt className="text-muted-foreground">{t("cost")}</dt><dd><Amount minor={costMinor} currency={currency} /></dd></div>
      <div className={row}><dt className="text-muted-foreground">{t("tender")}</dt><dd><Amount minor={settlement.tenderMinor} currency={settlement.tenderCurrency} /></dd></div>
      {settlement.changes.length === 0
        ? <div className={row}><dt className="text-muted-foreground">{t("change")}</dt><dd>{t("noChange")}</dd></div>
        : settlement.changes.map((change, index) => <Fragment key={`${change.balanceId}-${index}`}>
          <div className={row}><dt className="text-muted-foreground">{t("change")}</dt><dd><Amount minor={change.amountMinor} currency={change.currency} /></dd></div>
          <div className={row}><dt className="text-muted-foreground">{t("changeTo")}</dt><dd className="min-w-0 break-words"><bdi>{change.walletNameSnapshot ?? changeWalletNames[index] ?? change.currency}</bdi></dd></div>
          {change.rate ? <div className={row}><dt className="text-muted-foreground">{t("rate")}</dt><dd><bdi dir="ltr">1 {change.rate.base} = {settlementRateText(change.rate)} {change.rate.quote}</bdi></dd></div> : null}
        </Fragment>)}
    </dl>
    {hasHistoricalRate ? <p className="text-[13px] text-muted-foreground">{t("rateHelp")}</p> : null}
  </section>;
}
