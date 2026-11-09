"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { addCategory, deleteCategory, renameCategory } from "@/features/invoices/actions";
import { categoryLabel } from "@/features/invoices/display";
import { invoiceErrorKey } from "@/features/invoices/errors";
import { categoryCreateSchema, categoryRenameSchema, MAX_CATEGORIES, MAX_CATEGORY_NAME, type InvoiceCategory } from "@/features/invoices/schema";
import type { ActionResult } from "@/lib/supabase/action";

const failed = (): ActionResult => ({ ok: false, error: "failed" });
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The folder's categories. Everyone in the folder can add, rename and delete them. "Other" is
 * the default for rows with no choice, so it stays; deleting any other category moves its rows
 * there. Changes are applied here as soon as they are saved, and the page refresh that follows
 * brings the same list from the server.
 */
export function CategoriesSheet({ folderId, categories, counts, onClose, onAdded, onRenamed, onDeleted }: {
  folderId: string;
  categories: readonly InvoiceCategory[];
  /** Rows in each category, by id. */
  counts: ReadonlyMap<string, number>;
  onClose: () => void;
  onAdded: (category: InvoiceCategory) => void;
  onRenamed: (id: string, name: string) => void;
  onDeleted: (id: string) => void;
}) {
  const t = useTranslations("Invoices");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const taken = (name: string, except?: string) =>
    categories.some((category) => category.id !== except && (same(category.name, name) || (category.isDefault && same(t("categoryOther"), name))));
  const full = categories.length >= MAX_CATEGORIES;

  const parsedNew = categoryCreateSchema.safeParse({ id: draftId, folderId, name: draft });
  const newTaken = parsedNew.success && taken(parsedNew.data.name);
  const canAdd = parsedNew.success && !newTaken && !full;

  const run = (work: () => Promise<ActionResult>, done: () => void) => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await work().catch(failed);
      if (result.ok) done(); else setError(t(invoiceErrorKey(result.error)));
    });
  };

  const add = () => {
    if (!canAdd || !parsedNew.success) return;
    const input = parsedNew.data;
    run(() => addCategory(input), () => {
      onAdded({ id: input.id, folderId, name: input.name, isDefault: false, createdAt: new Date().toISOString() });
      setDraft(""); setDraftId(crypto.randomUUID());
    });
  };

  const parsedRename = editing ? categoryRenameSchema.safeParse({ name: editing.name }) : null;
  const renameTaken = !!editing && !!parsedRename?.success && taken(parsedRename.data.name, editing.id);
  const save = () => {
    if (!editing || !parsedRename?.success || renameTaken) return;
    const { id } = editing;
    const { name } = parsedRename.data;
    run(() => renameCategory(id, { name }), () => { onRenamed(id, name); setEditing(null); });
  };

  const remove = (id: string) => run(() => deleteCategory(id), () => { onDeleted(id); setDeleting(null); });

  return <SheetShell open title={t("categoriesTitle")} description={t("categoriesHelp")} dismissible={!pending} onOpenChange={(open) => !open && onClose()}
    footer={<Button variant="action" size="lg" className="w-full" disabled={pending} onClick={onClose}>{t("done")}</Button>}>
    <div className="flex flex-col gap-4">
      <form noValidate onSubmit={(event) => { event.preventDefault(); add(); }} className="flex flex-col gap-1.5">
        <div className="flex items-end gap-2">
          <TextField className="min-w-0 flex-1" label={t("newCategory")} placeholder={t("categoryPlaceholder")} value={draft} maxLength={MAX_CATEGORY_NAME}
            onChange={(event) => setDraft(event.target.value)} autoComplete="off" enterKeyHint="done" disabled={pending || full} />
          <Button type="submit" size="icon" aria-label={t("addCategory")} disabled={!canAdd} loading={pending && !editing && !deleting}><Plus aria-hidden /></Button>
        </div>
        {newTaken ? <p role="alert" className="text-sm text-over">{t("categoryExists")}</p> : null}
        {full ? <p className="text-[13px] text-muted-foreground">{t("categoryLimit", { count: MAX_CATEGORIES })}</p> : null}
      </form>

      <ul aria-label={t("categoriesLabel")} className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {categories.map((category) => {
          const label = categoryLabel(category, t("categoryOther"));
          const count = counts.get(category.id) ?? 0;
          if (editing?.id === category.id) {
            return <li key={category.id} className="p-3">
              <form noValidate onSubmit={(event) => { event.preventDefault(); save(); }} className="flex flex-col gap-2">
                <div className="flex items-end gap-2">
                  <TextField className="min-w-0 flex-1" label={t("renameCategory")} value={editing.name} maxLength={MAX_CATEGORY_NAME} autoFocus autoComplete="off"
                    onChange={(event) => setEditing({ id: category.id, name: event.target.value })} disabled={pending} />
                  <Button type="submit" size="icon" aria-label={t("saveName")} disabled={!parsedRename?.success || renameTaken} loading={pending}><Check aria-hidden /></Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={t("cancel")} disabled={pending} onClick={() => { setEditing(null); setError(null); }}><X aria-hidden /></Button>
                </div>
                {renameTaken ? <p role="alert" className="text-sm text-over">{t("categoryExists")}</p> : null}
              </form>
            </li>;
          }
          if (deleting === category.id) {
            return <li key={category.id} className="flex flex-col gap-2.5 bg-over-soft p-3.5">
              <p className="text-[15px] text-over-foreground">{t.rich("deleteCategoryHelp", { name: label, bdi: (chunks) => <bdi className="font-semibold">{chunks}</bdi> })}</p>
              <div className="flex gap-2">
                <Button variant="destructive" loading={pending} onClick={() => remove(category.id)}><Trash2 aria-hidden />{t("deleteCategory")}</Button>
                <Button variant="ghost" disabled={pending} onClick={() => { setDeleting(null); setError(null); }}>{t("keepCategory")}</Button>
              </div>
            </li>;
          }
          return <li key={category.id} className="flex min-h-[60px] items-center gap-1 ps-3.5 pe-1.5">
            <span className="flex min-w-0 flex-1 flex-col py-2">
              <span className="min-w-0 font-medium [overflow-wrap:anywhere]"><bdi>{label}</bdi></span>
              <span className="text-[13px] text-muted-foreground">
                {t("itemCount", { count })}{category.isDefault ? ` · ${t("categoryDefault")}` : ""}
              </span>
            </span>
            {category.isDefault ? null : <>
              <Button variant="ghost" size="icon" aria-label={t("renameCategoryNamed", { name: label })} disabled={pending}
                onClick={() => { setError(null); setDeleting(null); setEditing({ id: category.id, name: category.name }); }}><Pencil aria-hidden /></Button>
              <Button variant="ghost" size="icon" aria-label={t("deleteCategoryNamed", { name: label })} disabled={pending}
                onClick={() => { setError(null); setEditing(null); setDeleting(category.id); }}><Trash2 aria-hidden /></Button>
            </>}
          </li>;
        })}
      </ul>
      {error ? <p role="alert" className="text-sm text-over">{error}</p> : null}
    </div>
  </SheetShell>;
}
