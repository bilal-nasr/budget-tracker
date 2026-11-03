"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { TileBar } from "@/components/budget/tile-bar";
import { useDisplayPrefs } from "@/components/providers/display-prefs";
import { useComposer } from "@/components/shell/composer";
import { Button } from "@/components/ui/button";
import type { Installment } from "@/features/installments/schema";
import { formatAmount } from "@/lib/money";
import { cn } from "@/lib/utils";

function Row({ item }: { item: Installment }) {
  const t = useTranslations("Installments");
  const { openInstallment, openInstallmentPay } = useComposer();
  const { digits } = useDisplayPrefs();
  const money = (value: number) => `⁦${formatAmount(value, item.currency, { digits })}⁩`;
  const paidOff = item.remainingMinor <= 0;
  return (
    <li className="flex flex-col gap-2 border-t border-border px-1 py-3 first:border-t-0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => openInstallment(item)}
          aria-label={t("editItem", { name: item.name })}
          className="min-w-0 flex-1 rounded-lg text-start"
        >
          <span className="block truncate font-medium">
            <bdi>{item.name}</bdi>
          </span>
          <span className="block truncate text-[13px] text-muted-foreground">
            {t("leftOf", { left: money(Math.max(0, item.remainingMinor)), total: money(item.totalMinor) })}
          </span>
        </button>
        {paidOff ? (
          <span className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-positive">
            <Check aria-hidden className="size-4" />
            {t("paidOff")}
          </span>
        ) : (
          <Button className="shrink-0" aria-label={t("payItem", { name: item.name })} onClick={() => openInstallmentPay(item)}>
            {t("pay")}
          </Button>
        )}
      </div>
      <TileBar
        value={item.totalMinor > 0 ? item.paidMinor / item.totalMinor : 0}
        label={t("meterLabel", { name: item.name, paid: money(item.paidMinor), total: money(item.totalMinor) })}
      />
    </li>
  );
}

/** Installments in the Fixed expenses card: open ones first, paid-off ones collapsed. */
export function InstallmentsList({ items }: { items: Installment[] }) {
  const t = useTranslations("Installments");
  const [showPaidOff, setShowPaidOff] = useState(false);
  if (items.length === 0) return null;
  const open = items.filter((i) => i.remainingMinor > 0);
  const paidOff = items.filter((i) => i.remainingMinor <= 0);
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-3">
      <h3 id="h-installments" className="text-sm font-medium">{t("title")}</h3>
      <ul aria-labelledby="h-installments" className="-mx-1 flex flex-col">
        {open.map((i) => (
          <Row key={i.id} item={i} />
        ))}
      </ul>
      {paidOff.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={showPaidOff}
            onClick={() => setShowPaidOff((v) => !v)}
            className="flex min-h-11 items-center justify-between text-start text-sm text-muted-foreground"
          >
            {t("paidOffGroup", { count: paidOff.length })}
            <ChevronDown aria-hidden className={cn("size-4 transition-transform", showPaidOff && "rotate-180")} />
          </button>
          {showPaidOff ? (
            <ul className="-mx-1 flex flex-col">
              {paidOff.map((i) => (
                <Row key={i.id} item={i} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
