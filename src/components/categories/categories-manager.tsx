"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, GripVertical, Plus } from "lucide-react";
import { toast } from "sonner";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { CategoryGlyph } from "@/components/tiles/tile-glyph";
import { reorderCategories, restoreCategory } from "@/features/categories/actions";
import { categoryErrorMessageKey } from "@/features/categories/messages";
import { activeCategories, categoryName, type Category } from "@/features/categories/catalogue";

// The editor loads on first open, then stays mounted for its exit animation.
const CategorySheet = dynamic(() => import("./category-sheet").then((m) => m.CategorySheet));

function orderedCategories(categories: Category[], ids: string[] | undefined): Category[] {
  if (!ids) return categories;
  const byId = new Map(categories.map((category) => [category.id, category]));
  const ordered = ids.flatMap((id) => {
    const category = byId.get(id);
    if (!category) return [];
    byId.delete(id);
    return [category];
  });
  return [...ordered, ...byId.values()];
}

function SortableCategory({
  category,
  disabled,
  keyboardDragging,
  onEdit,
  onHandleKeyDown,
}: {
  category: Category;
  disabled: boolean;
  keyboardDragging: boolean;
  onEdit: () => void;
  onHandleKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const t = useTranslations("Categories");
  const locale = useLocale();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.id, disabled });
  const name = categoryName(category, locale);
  return (
    <li
      ref={setNodeRef}
      className={isDragging ? "relative z-10 bg-card shadow-lg" : "bg-card"}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="flex min-h-16 items-stretch">
        <button
          {...attributes}
          {...listeners}
          type="button"
          aria-label={t("reorderNamed", { name })}
          aria-describedby="category-sort-help"
          aria-pressed={keyboardDragging}
          disabled={disabled}
          className="grid w-12 shrink-0 touch-none cursor-grab place-items-center text-muted-foreground active:cursor-grabbing disabled:cursor-default focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          onKeyDown={onHandleKeyDown}
        >
          <GripVertical aria-hidden className="size-5" />
        </button>
        <button type="button" aria-label={t("editNamed", { name })} onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 py-2 pe-3.5 text-start hover:bg-secondary/50 active:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
          <CategoryGlyph tile={category.tile} color={category.color} /><span className="min-w-0 flex-1 truncate font-medium"><bdi>{name}</bdi></span><ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
        </button>
      </div>
    </li>
  );
}

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const t = useTranslations("Categories");
  const locale = useLocale();
  const [kind, setKind] = useState<Category["kind"]>("expense");
  const [editor, setEditorState] = useState<{ category: Category | null } | null>(null);
  const [editorMounted, setEditorMounted] = useState(false);
  const setEditor = (next: { category: Category | null } | null) => { if (next) setEditorMounted(true); setEditorState(next); };
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const addRef = useRef<HTMLButtonElement>(null);
  const [optimistic, updateOptimistic] = useOptimistic(categories, (current, updated: Category) => current.map((c) => c.id === updated.id ? updated : c));
  const [orders, setOrders] = useState<Partial<Record<Category["kind"], string[]>>>({});
  const [dragStartOrder, setDragStartOrder] = useState<string[] | null>(null);
  const [keyboardDragging, setKeyboardDragging] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const active = orderedCategories(activeCategories(optimistic, kind), orders[kind]);
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

  const saveOrder = (next: Category[], previousIds: string[]) => {
    const nextIds = next.map((category) => category.id);
    setOrders((current) => ({ ...current, [kind]: nextIds }));
    setError(null);
    startTransition(async () => {
      try {
        const result = await reorderCategories(kind, nextIds);
        if (!result.ok) {
          setOrders((current) => ({ ...current, [kind]: previousIds }));
          setError(t(categoryErrorMessageKey(result.error)));
          return;
        }
        toast(t("reordered"));
      } catch {
        setOrders((current) => ({ ...current, [kind]: previousIds }));
        setError(t("errorFailed"));
      }
    });
  };
  const onDragStart = () => setDragStartOrder(active.map((category) => category.id));
  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    const previousIds = dragStartOrder ?? active.map((category) => category.id);
    setDragStartOrder(null);
    if (!over || dragged.id === over.id) return;
    const from = active.findIndex((category) => category.id === dragged.id);
    const to = active.findIndex((category) => category.id === over.id);
    if (from < 0 || to < 0) return;
    setAnnouncement(t("sortDropped", { name: categoryName(active[from], locale), position: to + 1, count: active.length }));
    saveOrder(arrayMove(active, from, to), previousIds);
  };
  const onHandleKeyDown = (category: Category, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (pending) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (keyboardDragging === category.id) {
        const previousIds = dragStartOrder ?? active.map((item) => item.id);
        setKeyboardDragging(null);
        setDragStartOrder(null);
        setAnnouncement(t("sortDropped", { name: categoryName(category, locale), position: active.findIndex((item) => item.id === category.id) + 1, count: active.length }));
        if (active.map((item) => item.id).join() !== previousIds.join()) saveOrder(active, previousIds);
      } else {
        setKeyboardDragging(category.id);
        setDragStartOrder(active.map((item) => item.id));
        setAnnouncement(t("sortPicked", { name: categoryName(category, locale), position: active.findIndex((item) => item.id === category.id) + 1, count: active.length }));
      }
      return;
    }
    if (keyboardDragging !== category.id) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (dragStartOrder) setOrders((current) => ({ ...current, [kind]: dragStartOrder }));
      setKeyboardDragging(null);
      setDragStartOrder(null);
      setAnnouncement(t("sortCancelled", { name: categoryName(category, locale) }));
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const from = active.findIndex((item) => item.id === category.id);
    const to = Math.max(0, Math.min(active.length - 1, from + (event.key === "ArrowUp" ? -1 : 1)));
    if (from !== to) {
      setOrders((current) => ({ ...current, [kind]: arrayMove(active, from, to).map((item) => item.id) }));
      setAnnouncement(t("sortMoved", { name: categoryName(category, locale), position: to + 1, count: active.length }));
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[15px] text-muted-foreground">{t("intro")}</p>
      <Segmented label={t("kind")} value={kind} onChange={(next) => {
        if (keyboardDragging && dragStartOrder) setOrders((current) => ({ ...current, [kind]: dragStartOrder }));
        setKind(next);
        setError(null);
        setKeyboardDragging(null);
        setDragStartOrder(null);
      }} options={[{ value: "expense", label: t("expense") }, { value: "income", label: t("income") }]} />
      <Button ref={addRef} variant="outline" className="w-full gap-2" onClick={() => setEditor({ category: null })}><Plus aria-hidden className="size-4" />{t("add")}</Button>
      <p id="category-sort-help" className="text-sm text-muted-foreground">{t("sortHelp")}</p>
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      {active.length ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragCancel={() => setDragStartOrder(null)} onDragEnd={onDragEnd}>
          <SortableContext items={active.map((category) => category.id)} strategy={verticalListSortingStrategy}>
            <ul aria-label={t("active")} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {active.map((category) => <SortableCategory key={category.id} category={category} disabled={pending} keyboardDragging={keyboardDragging === category.id} onEdit={() => setEditor({ category })} onHandleKeyDown={(event) => onHandleKeyDown(category, event)} />)}
            </ul>
          </SortableContext>
        </DndContext>
      ) : <p className="py-4 text-[15px] text-muted-foreground">{t("empty")}</p>}
      {hasArchives ? <details className="border-t border-border pt-3"><summary className="flex min-h-11 cursor-pointer items-center rounded-lg text-[15px] font-medium focus-visible:outline-2 focus-visible:outline-ring">{t("archivedList", { count: archived.length })}</summary>
        <ul className="mt-2 divide-y divide-border" aria-label={t("archived")}>
          {archived.map((category) => <li key={category.id} className="flex min-h-16 items-center gap-3 py-2"><CategoryGlyph tile={category.tile} color={category.color} /><span className="min-w-0 flex-1 truncate text-muted-foreground"><bdi>{categoryName(category, locale)}</bdi></span><Button variant="outline" disabled={pending} aria-label={t("restoreNamed", { name: categoryName(category, locale) })} onClick={() => restore(category)}>{t("restore")}</Button></li>)}
        </ul>
      </details> : null}
      {error ? <p role="alert" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm">{error}</p> : null}
      {editorMounted ? <CategorySheet open={editor !== null} category={editor?.category ?? null} kind={kind} onOpenChange={(open) => { if (!open) setEditor(null); }} onOptimisticUpdate={updateOptimistic} /> : null}
    </div>
  );
}
