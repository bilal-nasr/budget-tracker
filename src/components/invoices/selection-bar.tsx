"use client";

import { useTranslations } from "next-intl";
import { Check, FolderInput, Trash2, X } from "lucide-react";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { rowDefinition } from "@/features/invoices/display";
import type { CurrencyTotal } from "@/features/invoices/schema";
import type { CurrencyDefinition } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * Totals of some rows (the ticked ones, or the ones still to pay), one line per currency and
 * never added together. A total that cannot be summed says so in the same words as the
 * folder's own totals.
 */
export function SelectedTotals({ totals, catalog, className, lineClassName, label }: {
  totals: readonly CurrencyTotal[];
  catalog: ReadonlyMap<string, CurrencyDefinition>;
  className?: string;
  lineClassName?: string;
  /** Names the list for assistive technology; the ticked rows' totals when omitted. */
  label?: string;
}) {
  const t = useTranslations("Invoices");
  return <ul aria-label={label ?? t("selectedTotalsLabel")} className={className}>
    {totals.map((total) => <li key={`${total.currency}:${total.decimalPlaces}`} className={cn("min-w-0", lineClassName)}>
      {total.minor === null
        ? <span>{t.rich("totalTooLarge", { currency: total.currency, bdi: (chunks) => <bdi dir="ltr">{chunks}</bdi> })}</span>
        : <Amount minor={total.minor} currency={rowDefinition(total, catalog)} className="[overflow-wrap:anywhere] whitespace-normal!" />}
    </li>)}
  </ul>;
}

// Three across at any phone width: tighter padding, and the icon gives way on the narrowest screens.
const actionClass = "min-w-0 px-2 max-[359px]:[&_svg]:hidden";

/**
 * Sticks above the bottom navigation while something is ticked: how many, their totals per
 * currency (wrapping, never scrolling sideways), "select all" for the whole folder, a button
 * that clears the selection, and what can be done with the ticked rows: delete them, move
 * them to a category, or pay them. Paying only counts the rows nobody has paid yet.
 */
export function SelectionBar({ count, totals, catalog, allPicked, payable, onSelectAll, onClear, onDelete, onMove, onPay }: {
  count: number;
  totals: readonly CurrencyTotal[];
  catalog: ReadonlyMap<string, CurrencyDefinition>;
  /** Every row of the folder is ticked, so "select all" has nothing left to do. */
  allPicked: boolean;
  /** How many ticked rows are still unpaid. */
  payable: number;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
  onMove: () => void;
  onPay: () => void;
}) {
  const t = useTranslations("Invoices");
  return <div role="region" aria-label={t("selectionBarLabel")}
    className="sticky bottom-[calc(124px+var(--safe-bottom))] z-20 flex flex-col gap-2 rounded-xl border border-border bg-card p-2 md:bottom-4">
    <div className="flex items-center gap-1 ps-1.5">
      <div className="min-w-0 flex-1 text-sm">
        <span className="block text-muted-foreground">{t("selectedLabel", { count })}</span>
        <SelectedTotals totals={totals} catalog={catalog} className="flex flex-wrap gap-x-3" lineClassName="text-[17px] font-semibold" />
      </div>
      {allPicked ? null : <Button variant="ghost" size="sm" className="shrink-0 px-2.5" aria-label={t("selectAllItems")} onClick={onSelectAll}>{t("selectAll")}</Button>}
      <Button variant="ghost" size="icon" className="shrink-0" aria-label={t("clearSelection")} onClick={onClear}><X aria-hidden /></Button>
    </div>
    <div className="grid grid-cols-3 gap-2">
      <Button variant="destructive" className={actionClass} aria-label={t("deleteSelected", { count })} onClick={onDelete}><Trash2 aria-hidden />{t("bulkDelete")}</Button>
      <Button variant="outline" className={actionClass} aria-label={t("moveSelected", { count })} onClick={onMove}><FolderInput aria-hidden />{t("bulkMove")}</Button>
      <Button className={actionClass} disabled={!payable} aria-label={t("paySelected", { count: payable })} onClick={onPay}><Check aria-hidden />{t("bulkPay")}</Button>
    </div>
  </div>;
}
