"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { CategoryGlyph } from "@/components/tiles/tile-glyph";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { categoryName, type Category } from "@/features/categories/catalogue";

/**
 * Pick one category for several expenses (or several incomes). Nothing changes until Apply;
 * `skipped` rows keep their category and the sheet says so.
 */
export function BulkCategorySheet({ open, onOpenChange, categories, count, skipped, pending, error, onApply }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Live categories of the one kind every chosen row shares. */
  categories: Category[];
  count: number;
  skipped: number;
  pending: boolean;
  error: string | null;
  onApply: (categoryId: string) => void;
}) {
  const t = useTranslations("Activity");
  const locale = useLocale();
  const name = useId();
  const [choice, setChoice] = useState("");
  const chosen = categories.some((category) => category.id === choice) ? choice : "";
  return (
    <SheetShell
      open={open}
      onOpenChange={(next) => { if (next || !pending) onOpenChange(next); }}
      title={t("bulkCategoryTitle", { count })}
      footer={
        <Button variant="action" size="lg" className="w-full" loading={pending} disabled={!chosen} onClick={() => chosen && onApply(chosen)}>
          {t("apply")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-[15px]">
        {skipped > 0 ? <p className="text-muted-foreground">{t("bulkCategorySkipped", { count: skipped })}</p> : null}
        <div role="radiogroup" aria-label={t("category")} className="overflow-hidden rounded-xl border border-border">
          {categories.map((category) => (
            <label key={category.id} className="flex min-h-14 cursor-pointer items-center gap-3 border-b border-border px-3.5 py-2 last:border-b-0 has-checked:bg-accent/60 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring">
              <input type="radio" name={name} value={category.id} checked={chosen === category.id} disabled={pending} onChange={() => setChoice(category.id)} className="peer sr-only" />
              <CategoryGlyph tile={category.tile} color={category.color} />
              <span className="min-w-0 flex-1 truncate font-medium"><bdi>{categoryName(category, locale)}</bdi></span>
              <Check aria-hidden className="size-5 shrink-0 text-primary opacity-0 peer-checked:opacity-100" strokeWidth={2.6} />
            </label>
          ))}
        </div>
        {error ? <p role="alert" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm">{error}</p> : null}
      </div>
    </SheetShell>
  );
}
