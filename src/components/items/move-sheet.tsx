"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRuntimeBalances } from "@/components/add/runtime-balances";
import { useLoanSubmission } from "@/components/loans/use-loan-submission";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { createFolder } from "@/features/invoices/actions";
import type { InvoiceFolderChoice } from "@/features/invoices/choices";
import { folderCreateSchema, MAX_NAME } from "@/features/invoices/schema";
import { moveItemsToFolder } from "@/features/items/actions";
import { itemErrorKey } from "@/features/items/errors";
import { itemMoveSchema, MAX_MOVE_ITEMS, type ShoppingItem } from "@/features/items/schema";
import type { ActionResult } from "@/lib/supabase/action";
import { currencyIntent } from "@/lib/currency-intent";
import { sumMinor } from "@/lib/money";
import { useRouter } from "@/i18n/navigation";

const NEW = "new";

type MovePayload = {
  expectedUnits: NonNullable<ReturnType<typeof currencyIntent>>;
  folderId: string;
  itemIds: string[];
  /** Present when the folder is created first; its id is fixed so a retry reuses the same folder. */
  newFolder: { id: string; name: string } | null;
};

/** Creates the folder when asked to (safe to repeat: the id is chosen here), then moves the rows into it. */
async function run(payload: MovePayload): Promise<ActionResult<{ moved: number }>> {
  if (payload.newFolder) {
    const made = await createFolder(payload.newFolder);
    if (!made.ok) return made;
  }
  return moveItemsToFolder({ expectedUnits: payload.expectedUnits, folderId: payload.folderId, itemIds: payload.itemIds });
}

/**
 * "Move to folder": the ticked items leave the list and become rows of an invoice folder, either
 * one that exists or a new one named here. Nothing is recorded in Activity.
 */
export function MoveSheet({ items, folders, onClose, onDone }: {
  items: ShoppingItem[];
  folders: InvoiceFolderChoice[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("Items");
  const tInvoices = useTranslations("Invoices");
  const router = useRouter();
  const { definition } = useRuntimeBalances();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const currency = items[0].currency;
  const unit = definition(currency);
  const total = sumMinor(items.map((item) => item.priceMinor));

  const [choice, setChoice] = useState<string>(folders[0]?.id ?? NEW);
  const [name, setName] = useState("");
  // Fixed for this sheet's lifetime: retrying after a lost response lands in the same folder.
  const [newFolderId] = useState(() => crypto.randomUUID());
  const creating = choice === NEW;

  const submission = useLoanSubmission<MovePayload, { moved: number }>(run, ({ moved }) => {
    const folderId = creating ? newFolderId : choice;
    const folderName = creating ? name.trim() : (folders.find((folder) => folder.id === choice)?.name ?? "");
    onDone(); onClose();
    toast(t("moved", { count: moved, folder: folderName }), { action: { label: t("openFolder"), onClick: () => router.push(`/invoices/${folderId}`) } });
  });

  const folder = creating ? folderCreateSchema.safeParse({ id: newFolderId, name }) : null;
  const folderId = creating ? newFolderId : choice;
  const units = currencyIntent(unit);
  const parsed = itemMoveSchema.safeParse({ expectedUnits: units, folderId, itemIds: items.map((item) => item.id) });
  const valid = parsed.success && !!units && !unit.disabled && (!creating || !!folder?.success) && (creating || folders.some((entry) => entry.id === choice));
  const payload: MovePayload | null = valid && parsed.success && units
    ? { ...parsed.data, expectedUnits: units, newFolder: creating && folder?.success ? { id: folder.data.id, name: folder.data.name } : null }
    : null;

  const errorText = !submission.error ? null
    : submission.uncertain ? t("errorUncertain")
    : submission.error === "limitReached" ? t(creating ? "errorFolderLimit" : "errorFolderFull")
    : t(itemErrorKey(submission.error));
  const rowClass = "flex min-h-12 cursor-pointer items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0 has-[:checked]:bg-secondary has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ring";

  return <SheetShell open title={t("moveTitle")} description={t("moveHelp")} dismissible={submission.dismissible} onOpenChange={(open) => !open && onClose()}
    footer={submission.review ? <Button className="w-full" onClick={() => { onClose(); router.refresh(); }}>{t("review")}</Button> :
      <Button variant="action" size="lg" className="w-full" form={formId} type="submit" loading={submission.pending} disabled={!submission.uncertain && !payload}>
        {submission.uncertain ? t("retrySame") : t("moveConfirm", { count: items.length })}
      </Button>}>
    <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); submission.submit(payload); }} className="flex flex-col gap-4">
      <fieldset disabled={submission.frozen} className="flex min-w-0 flex-col gap-4 border-0 p-0">
        <p className="flex items-baseline justify-between gap-3 rounded-xl bg-secondary px-3.5 py-3 font-semibold">
          <span>{t("selectedLabel", { count: items.length })}</span>
          <Amount minor={total} currency={currency} className="shrink-0 text-[17px]" />
        </p>
        <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-sm font-medium">{t("folderLabel")}</legend>
          <div role="radiogroup" className="overflow-hidden rounded-xl border border-border">
            {folders.map((entry) => <label key={entry.id} className={rowClass}>
              <input type="radio" name="folder" value={entry.id} checked={choice === entry.id} onChange={() => setChoice(entry.id)} className="size-5 shrink-0 accent-primary" />
              <span className="min-w-0 break-words font-medium"><bdi>{entry.name}</bdi></span>
            </label>)}
            <label className={rowClass}>
              <input type="radio" name="folder" value={NEW} checked={creating} onChange={() => { setChoice(NEW); queueMicrotask(() => nameRef.current?.focus()); }} className="size-5 shrink-0 accent-primary" />
              <span className="font-medium">{t("newFolder")}</span>
            </label>
          </div>
        </fieldset>
        {creating ? <TextField ref={nameRef} label={tInvoices("folderName")} placeholder={tInvoices("folderNamePlaceholder")} value={name} maxLength={MAX_NAME}
          onChange={(event) => setName(event.target.value)} autoComplete="off" enterKeyHint="done" /> : null}
      </fieldset>
      {items.length > MAX_MOVE_ITEMS ? <p role="status" className="text-sm">{t("moveTooMany", { max: MAX_MOVE_ITEMS })}</p> : null}
      {errorText ? <p role="alert" className="text-sm">{errorText}</p> : null}
    </form>
  </SheetShell>;
}
