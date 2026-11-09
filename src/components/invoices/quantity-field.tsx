"use client";

import { useTranslations } from "next-intl";
import { Amount } from "@/components/money/amount";
import { TextField } from "@/components/ui/text-field";
import { MAX_QUANTITY } from "@/features/invoices/schema";
import type { CurrencyDefinition } from "@/lib/currency";
import { MAX_MINOR } from "@/lib/money";

/** How many units; whole numbers only, shown with a native numeric keypad. */
export function QuantityField({ text, onChange, valid }: { text: string; onChange: (text: string) => void; valid: boolean }) {
  const t = useTranslations("Invoices");
  return <TextField label={t("quantity")} value={text} onChange={(event) => onChange(event.target.value)} inputMode="numeric"
    maxLength={String(MAX_QUANTITY).length + 1} enterKeyHint="done" error={text.trim() && !valid ? t("errorQuantity", { max: MAX_QUANTITY }) : null} />;
}

/**
 * "Total $100.00" under the fields once more than one unit is entered, so it is clear the price
 * is for one. Nothing shows for a quantity of 1, a missing price, or a total out of range.
 */
export function LineTotal({ unit, priceMinor, quantity }: { unit: CurrencyDefinition | undefined; priceMinor: number | null; quantity: number | null }) {
  const t = useTranslations("Invoices");
  if (!unit || priceMinor === null || quantity === null || quantity < 2 || priceMinor * quantity > MAX_MINOR) return null;
  return <p className="text-[13px] text-muted-foreground">
    {t("lineTotal")} <Amount minor={priceMinor * quantity} currency={unit} className="font-semibold text-foreground" />
  </p>;
}
