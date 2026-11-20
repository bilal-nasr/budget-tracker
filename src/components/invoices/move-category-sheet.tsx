"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { categoryLabel } from "@/features/invoices/display";
import type { InvoiceCategory } from "@/features/invoices/schema";

const rowClass = "flex min-h-12 cursor-pointer items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0 has-[:checked]:bg-secondary has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ring";

/**
 * "Move to category": pick one of the folder's categories for every ticked row. The move itself
 * is the parent's (it shows at once and is one request), so this sheet only asks where to.
 */
export function MoveCategorySheet({ count, categories, onClose, onMove }: {
  /** How many rows are ticked. */
  count: number;
  categories: readonly InvoiceCategory[];
  onClose: () => void;
  onMove: (categoryId: string) => void;
}) {
  const t = useTranslations("Invoices");
  const formId = useId();
  const [choice, setChoice] = useState<string | null>(null);
  // A category someone deleted while the sheet was open is no longer a choice.
  const chosen = categories.find((category) => category.id === choice)?.id ?? null;
  return <SheetShell open title={t("moveTitle")} description={t("moveHelp", { count })} onOpenChange={(open) => !open && onClose()}
    footer={<Button variant="action" size="lg" className="w-full" form={formId} type="submit" disabled={!chosen}>{t("moveConfirm", { count })}</Button>}>
    <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); if (chosen) onMove(chosen); }}>
      <fieldset className="min-w-0 border-0 p-0">
        <legend className="mb-2 text-sm font-medium">{t("category")}</legend>
        <div role="radiogroup" className="overflow-hidden rounded-xl border border-border">
          {categories.map((category) => <label key={category.id} className={rowClass}>
            <input type="radio" name="category" value={category.id} checked={chosen === category.id} onChange={() => setChoice(category.id)} className="size-5 shrink-0 accent-primary" />
            <span className="min-w-0 font-medium [overflow-wrap:anywhere]"><bdi>{categoryLabel(category, t("categoryOther"))}</bdi></span>
          </label>)}
        </div>
      </fieldset>
    </form>
  </SheetShell>;
}
