"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Amount } from "@/components/money/amount";
import { useAppDataOptional } from "@/components/providers/app-data";
import { rowDefinition } from "@/features/invoices/display";
import type { CurrencyTotal } from "@/features/invoices/schema";
import { indexCurrencies } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * Per-currency totals, at most two and then "+N". Decimals come from the rows and a currency
 * the viewer never enabled shows as its own code, so a shared folder can never break a screen.
 */
export function FolderTotals({ totals, className }: { totals: readonly CurrencyTotal[]; className?: string }) {
  const t = useTranslations("Invoices");
  const app = useAppDataOptional();
  const catalog = useMemo(() => indexCurrencies(app?.currencies ?? []), [app?.currencies]);
  const shown = totals.slice(0, 2);
  if (!shown.length) return null;
  return (
    <span className={cn("flex flex-wrap gap-x-3", className)}>
      {shown.map((total) => total.minor === null
        ? <span key={`${total.currency}:${total.decimalPlaces}`} className="font-normal text-muted-foreground">{t.rich("totalTooLarge", { currency: total.currency, bdi: (chunks) => <bdi dir="ltr">{chunks}</bdi> })}</span>
        : <Amount key={`${total.currency}:${total.decimalPlaces}`} minor={total.minor} currency={rowDefinition(total, catalog)} />)}
      {totals.length > shown.length ? <span className="font-normal text-muted-foreground"><bdi dir="ltr">+{totals.length - shown.length}</bdi></span> : null}
    </span>
  );
}
