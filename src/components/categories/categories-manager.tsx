"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { CategoryGlyph } from "@/components/tiles/tile-glyph";
import { restoreCategory } from "@/features/categories/actions";
import { categoryErrorMessageKey } from "@/features/categories/messages";
import { activeCategories, categoryName, type Category } from "@/features/categories/schema";
import { CategorySheet } from "./category-sheet";

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const t = useTranslations("Categories");
  const locale = useLocale();
  const [kind, setKind] = useState<Category["kind"]>("expense");
  const [editor, setEditor] = useState<{ category: Category | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const addRef = useRef<HTMLButtonElement>(null);
  const [optimistic, updateOptimistic] = useOptimistic(categories, (current, updated: Category) => current.map((c) => c.id === updated.id ? updated : c));
  const active = activeCategories(optimistic, kind);
  const archived = optimistic.filter((c) => c.kind === kind && c.parentId === null && c.archivedAt !== null);
  const hasArchives = archived.length > 0 || categories.some((c) => c.kind === kind && c.parentId === null && c.archivedAt !== null);

  const restore = (category: Category) => {
    setError(null);
    startTransition(async () => {
      try {
        updateOptimistic({ ...category, archivedAt: null });
        const result = await restoreCategory(category.id);
        if (!result.ok) { setError(t(categoryErrorMessageKey(result.error))); return; }
        toast(t("restored"));
      } catch { setError(t("errorFailed")); }
      finally { addRef.current?.focus(); }
    });
  };
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[15px] text-muted-foreground">{t("intro")}</p>
      <Segmented label={t("kind")} value={kind} onChange={(next) => { setKind(next); setError(null); }} options={[{ value: "expense", label: t("expense") }, { value: "income", label: t("income") }]} />
      <Button ref={addRef} variant="outline" className="w-full gap-2" onClick={() => setEditor({ category: null })}><Plus aria-hidden className="size-4" />{t("add")}</Button>
      {active.length ? (
        <ul aria-label={t("active")} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {active.map((category) => <li key={category.id}><button type="button" aria-label={t("editNamed", { name: categoryName(category, locale) })} onClick={() => setEditor({ category })} className="flex min-h-16 w-full items-center gap-3 px-3.5 py-2 text-start hover:bg-secondary/50 active:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
            <CategoryGlyph tile={category.tile} color={category.color} /><span className="min-w-0 flex-1 truncate font-medium"><bdi>{categoryName(category, locale)}</bdi></span><ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
          </button></li>)}
        </ul>
      ) : <p className="py-4 text-[15px] text-muted-foreground">{t("empty")}</p>}
      {hasArchives ? <details className="border-t border-border pt-3"><summary className="flex min-h-11 cursor-pointer items-center rounded-lg text-[15px] font-medium focus-visible:outline-2 focus-visible:outline-ring">{t("archivedList", { count: archived.length })}</summary>
        <ul className="mt-2 divide-y divide-border" aria-label={t("archived")}>
          {archived.map((category) => <li key={category.id} className="flex min-h-16 items-center gap-3 py-2"><CategoryGlyph tile={category.tile} color={category.color} /><span className="min-w-0 flex-1 truncate text-muted-foreground"><bdi>{categoryName(category, locale)}</bdi></span><Button variant="outline" disabled={pending} aria-label={t("restoreNamed", { name: categoryName(category, locale) })} onClick={() => restore(category)}>{t("restore")}</Button></li>)}
        </ul>
      </details> : null}
      {error ? <p role="alert" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm">{error}</p> : null}
      <CategorySheet open={editor !== null} category={editor?.category ?? null} kind={kind} onOpenChange={(open) => { if (!open) setEditor(null); }} onOptimisticUpdate={updateOptimistic} />
    </div>
  );
}
