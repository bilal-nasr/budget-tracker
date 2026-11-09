"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { categoryLabel } from "@/features/invoices/display";
import type { InvoiceCategory } from "@/features/invoices/schema";

export const fieldSelectClass = "h-12 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

const NEW_CATEGORY = "__new__";

/**
 * The folder's categories as a native picker, so it works the same with a phone's wheel and a
 * desktop list. With `onNew` the last choice opens the category manager instead of selecting.
 */
export function CategorySelect({ categories, value, onChange, onNew }: {
  categories: readonly InvoiceCategory[];
  value: string;
  onChange: (categoryId: string) => void;
  onNew?: () => void;
}) {
  const t = useTranslations("Invoices");
  const id = useId();
  return <div className="flex min-w-0 flex-col gap-1.5">
    <label htmlFor={id} className="text-sm font-medium">{t("category")}</label>
    <select id={id} value={value} className={fieldSelectClass}
      onChange={(event) => { if (event.target.value === NEW_CATEGORY) onNew?.(); else onChange(event.target.value); }}>
      {categories.map((category) => <option key={category.id} value={category.id}>{categoryLabel(category, t("categoryOther"))}</option>)}
      {onNew ? <option value={NEW_CATEGORY}>{t("newCategoryOption")}</option> : null}
    </select>
  </div>;
}
