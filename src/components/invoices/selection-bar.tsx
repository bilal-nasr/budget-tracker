"use client";

import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { rowDefinition } from "@/features/invoices/display";
import type { CurrencyTotal } from "@/features/invoices/schema";
import type { CurrencyDefinition } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * The totals of the ticked rows, one line per currency and never added together. A total that
 * cannot be summed says so in the same words as the folder's own totals.
 */
export function SelectedTotals({ totals, catalog, className, lineClassName }: {
  totals: readonly CurrencyTotal[];
  catalog: ReadonlyMap<string, CurrencyDefinition>;
  className?: string;
  lineClassName?: string;
}) {
  const t = useTranslations("Invoices");
  return <ul aria-label={t("selectedTotalsLabel")} className={className}>
    {totals.map((total) => <li key={`${total.currency}:${total.decimalPlaces}`} className={cn("min-w-0", lineClassName)}>
      {total.minor === null
        ? <span>{t.rich("totalTooLarge", { currency: total.currency, bdi: (chunks) => <bdi dir="ltr">{chunks}</bdi> })}</span>
        : <Amount minor={total.minor} currency={rowDefinition(total, catalog)} className="[overflow-wrap:anywhere] whitespace-normal!" />}
    </li>)}
  </ul>;
}

/**
 * Sticks above the bottom navigation while something is ticked: how many, their totals per
 * currency (wrapping, never scrolling sideways) and a button that clears the selection.
 */
export function SelectionBar({ count, totals, catalog, onClear }: {
  count: number;
  totals: readonly CurrencyTotal[];
  catalog: ReadonlyMap<string, CurrencyDefinition>;
  onClear: () => void;
}) {
  const t = useTranslations("Invoices");
  return <div role="region" aria-label={t("selectionBarLabel")}
    className="sticky bottom-[calc(124px+var(--safe-bottom))] z-20 flex items-center gap-2 rounded-xl border border-border bg-card p-2 ps-3.5 md:bottom-4">
    <div className="min-w-0 flex-1 text-sm">
      <span className="block text-muted-foreground">{t("selectedLabel", { count })}</span>
      <SelectedTotals totals={totals} catalog={catalog} className="flex flex-wrap gap-x-3" lineClassName="text-[17px] font-semibold" />
    </div>
    <Button variant="ghost" size="icon" aria-label={t("clearSelection")} onClick={onClear}><X aria-hidden /></Button>
  </div>;
}
