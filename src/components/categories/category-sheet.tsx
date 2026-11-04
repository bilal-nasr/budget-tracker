"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { CategoryGlyph, type TileColor, type TileId } from "@/components/tiles/tile-glyph";
import { createCategory, removeCategory, updateCategory } from "@/features/categories/actions";
import { categoryErrorMessageKey } from "@/features/categories/messages";
import { categoryCreateSchema, categoryEditSchema, categoryName, type Category } from "@/features/categories/schema";

const tiles: TileId[] = [1, 2, 3, 4, 5, 6, 7, 8];
const colors: TileColor[] = ["teal", "oxblood", "ochre"];
const inputClass = "h-12 w-full rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

type Props = {
  category: Category | null;
  kind: Category["kind"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOptimisticUpdate?: (category: Category) => void;
};

function Editor({ category, kind, onOpenChange, onOptimisticUpdate }: Omit<Props, "open">) {
  const t = useTranslations("Categories");
  const locale = useLocale();
  const formId = useId();
  const [nameEn, setNameEn] = useState(category?.nameEn ?? "");
  const [nameAr, setNameAr] = useState(category?.nameAr ?? "");
  const [tile, setTile] = useState<TileId>(category?.tile ?? 1);
  const [color, setColor] = useState<TileColor>(category?.color ?? "teal");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) cancelRef.current?.focus(); }, [confirming]);
  const edit = categoryEditSchema.safeParse({ nameEn, nameAr, tile, color });
  const longName = Array.from(nameEn).length > 40 || Array.from(nameAr).length > 40;
  const preview = { nameEn: nameEn || null, nameAr: nameAr || null };
  const title = confirming ? t("removeTitle") : category ? t("editTitle") : t("createTitle");

  const save = () => {
    if (!edit.success || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        if (category) onOptimisticUpdate?.({ ...category, ...edit.data });
        const result = category
          ? await updateCategory(category.id, edit.data)
          : await createCategory(categoryCreateSchema.parse({ ...edit.data, kind }));
        if (!result.ok) { setError(t(categoryErrorMessageKey(result.error))); return; }
        toast(t("saved"));
        onOpenChange(false);
      } catch { setError(t("errorFailed")); }
    });
  };
  const remove = () => {
    if (!category || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await removeCategory(category.id);
        if (!result.ok) { setError(t(categoryErrorMessageKey(result.error))); return; }
        toast(t(result.outcome === "deleted" ? "deleted" : "archivedDone"));
        onOpenChange(false);
      } catch { setError(t("errorFailed")); }
    });
  };

  return (
    <SheetShell
      open
      onOpenChange={(next) => { if (!pending) onOpenChange(next); }}
      title={title}
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p role="alert" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm">{error}</p> : null}
          {confirming ? (
            <div className="grid grid-cols-2 gap-3">
              <Button ref={cancelRef} variant="outline" disabled={pending} onClick={() => { setConfirming(false); setError(null); }}>{t("cancel")}</Button>
              <Button disabled={pending} onClick={remove}>{pending ? t("removing") : t("confirmRemove")}</Button>
            </div>
          ) : (
            <Button type="submit" form={formId} variant="action" size="lg" disabled={!edit.success || pending}>{pending ? t("saving") : t("save")}</Button>
          )}
        </div>
      }
    >
      {confirming ? (
        <div className="flex flex-col gap-4 text-[15px]">
          <div className="flex min-w-0 items-center gap-3"><CategoryGlyph tile={tile} color={color} /><span className="min-w-0 break-words font-semibold"><bdi>{category ? categoryName(category, locale) : ""}</bdi></span></div>
          <p>{t("removeCopy")}</p><p className="text-muted-foreground">{t("removeDependencies")}</p>
        </div>
      ) : (
        <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); save(); }} className="flex flex-col gap-5" aria-busy={pending}>
          <p className="text-sm text-muted-foreground">{t("kind")}: <span className="font-medium text-foreground">{t(kind)}</span></p>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor={`${formId}-en`}>{t("englishName")}
              <input id={`${formId}-en`} value={nameEn} onChange={(event) => setNameEn(event.target.value)} dir="auto" autoComplete="off" maxLength={80} aria-describedby={`${formId}-help`} className={inputClass} disabled={pending} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor={`${formId}-ar`}>{t("arabicName")}
              <input id={`${formId}-ar`} value={nameAr} onChange={(event) => setNameAr(event.target.value)} dir="auto" autoComplete="off" maxLength={80} aria-describedby={`${formId}-help`} className={inputClass} disabled={pending} />
            </label>
            <p id={`${formId}-help`} className="text-sm text-muted-foreground">{t("namesHelp")}</p>
            {longName ? <p role="alert" className="text-sm">{t("nameLength")}</p> : null}
          </div>
          <fieldset disabled={pending}>
            <legend className="mb-2 text-sm font-medium">{t("tile")}</legend>
            <div className="grid grid-cols-4 gap-2">
              {tiles.map((value) => <label key={value} className="relative grid min-h-16 cursor-pointer place-items-center rounded-lg border border-border p-2 has-checked:border-primary has-checked:bg-secondary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
                <input className="sr-only" type="radio" name={`${formId}-tile`} value={value} checked={tile === value} onChange={() => setTile(value)} aria-label={t(`motif${value}`)} />
                <CategoryGlyph tile={value} color={color} />
              </label>)}
            </div>
          </fieldset>
          <fieldset disabled={pending}>
            <legend className="mb-2 text-sm font-medium">{t("color")}</legend>
            <div className="grid grid-cols-3 gap-2">
              {colors.map((value) => <label key={value} className="relative flex min-h-11 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-border px-1 py-2 text-center text-sm has-checked:border-primary has-checked:bg-secondary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
                <input className="sr-only" type="radio" name={`${formId}-color`} value={value} checked={color === value} onChange={() => setColor(value)} />
                <CategoryGlyph tile={tile} color={value} /><span>{t(value)}</span>
              </label>)}
            </div>
          </fieldset>
          <div aria-label={t("preview")} className="flex min-w-0 items-center gap-3 border-t border-border pt-4"><CategoryGlyph tile={tile} color={color} /><span className="min-w-0 break-words font-medium"><bdi>{categoryName(preview, locale) || t("preview")}</bdi></span></div>
          {category ? <Button type="button" variant="outline" disabled={pending} onClick={() => { setConfirming(true); setError(null); }}>{t("remove")}</Button> : null}
        </form>
      )}
    </SheetShell>
  );
}

export function CategorySheet(props: Props) {
  if (!props.open) return null;
  return <Editor key={props.category?.id ?? `new-${props.kind}`} {...props} />;
}
