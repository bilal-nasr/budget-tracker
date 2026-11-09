"use client";

import { useEffect, useId, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { ChevronLeft, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { EmptyState } from "@/components/shell/empty-state";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { addItem, deleteFolder, deleteItem, renameFolder, restoreItem, updateItem } from "@/features/invoices/actions";
import { rowDefinition } from "@/features/invoices/display";
import { invoiceErrorKey } from "@/features/invoices/errors";
import type { InvoiceFolderDetail } from "@/features/invoices/queries";
import { folderRenameSchema, MAX_NAME, type CurrencyTotal, type InvoiceItem, type ItemEditInput, type SavedTimes } from "@/features/invoices/schema";
import { totalsByCurrency } from "@/features/invoices/totals";
import { indexCurrencies, type CurrencyDefinition } from "@/lib/currency";
import type { ActionResult } from "@/lib/supabase/action";
import { Link, useRouter } from "@/i18n/navigation";
import { AddInvoiceItemForm } from "./add-invoice-item-form";
import { ShareSheet } from "./share-sheet";
import { useLiveFolder } from "./use-live-folder";

// Sheets load on first open; the folder renders without their code.
const InvoiceItemSheet = dynamic(() => import("./invoice-item-sheet").then((m) => m.InvoiceItemSheet));
const ConfirmSheet = dynamic(() => import("@/components/ui/confirm-sheet").then((m) => m.ConfirmSheet));

/** A finished change from someone else (arriving live), or a local one once it is saved. */
export type FolderItemChange = { type: "upsert"; item: InvoiceItem } | { type: "delete"; id: string };

/** Same order as the server: newest first, ties by id. */
const newestFirst = (a: InvoiceItem, b: InvoiceItem) =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id.localeCompare(b.id);

/** Idempotent, so a change applied twice (optimistically and again when confirmed or echoed back) lands once. */
function applyChange(list: InvoiceItem[], change: FolderItemChange): InvoiceItem[] {
  if (change.type === "delete") return list.some((row) => row.id === change.id) ? list.filter((row) => row.id !== change.id) : list;
  return [...list.filter((row) => row.id !== change.item.id), change.item].sort(newestFirst);
}

/** How long the Undo toast stays up. */
const UNDO_MS = 10_000;

const failed = (): ActionResult<never> => ({ ok: false, error: "failed" });
const withSavedTimes = (item: InvoiceItem, { createdAt, updatedAt }: SavedTimes): InvoiceItem => ({ ...item, createdAt, updatedAt });

const changedId = (change: FolderItemChange) => change.type === "delete" ? change.id : change.item.id;
/** The seconds of a time of day and the fraction after them (`:05.123456`). */
const FRACTION = /(:\d{2})\.(\d+)/;
/**
 * A timestamp as microseconds since the epoch, or null when it cannot be read (an unreadable
 * one always loses). PostgreSQL keeps microseconds and the database makes every update strictly
 * later, so two saves less than a millisecond apart must not look equal: the fraction is read
 * here (up to six digits) and only the whole seconds and the offset go through `Date.parse`.
 */
function instant(iso: string): bigint | null {
  const fraction = FRACTION.exec(iso);
  const seconds = Date.parse(fraction ? iso.replace(FRACTION, "$1") : iso);
  if (Number.isNaN(seconds)) return null;
  return BigInt(seconds) * 1000n + BigInt((fraction?.[2] ?? "").slice(0, 6).padEnd(6, "0"));
}

/*
 * Every timestamp compared in `shownIn` and `record` comes from the server's clock: snapshots
 * and Realtime rows are database values, and a local save (add, edit or Undo) is confirmed with
 * the timestamps its action read back (`SavedTimes`) through `withSavedTimes`, never with the
 * device's clock. An edit's pending copy keeps the row's confirmed timestamps. The one
 * device-clock value left is a new row's `createdAt` and `updatedAt` while its add is pending
 * (set by the add form): `newestFirst` uses them only to place that unsaved row in the
 * optimistic list, which is never compared for versions. Whatever is logged is always the
 * saved row with the server's times, so a skewed clock can misplace an unsaved row for at most
 * one round trip and never reaches the log.
 */

/** True when the snapshot already shows `change`, or the same version or something newer for that row. */
function shownIn(rows: ReadonlyMap<string, InvoiceItem>, change: FolderItemChange) {
  const there = rows.get(changedId(change));
  if (change.type === "delete") return !there;
  if (!there) return false;
  const [mine, theirs] = [instant(change.item.updatedAt), instant(there.updatedAt)];
  if (mine === null) return true;
  if (theirs === null) return false;
  // An equal time is the same server version: a retry can answer with another person's
  // timestamp, and their row (not this copy of it) is what the snapshot shows.
  return theirs >= mine;
}

/** Every finished change (saved here or made by someone else), latest per row, with the snapshot it arrived during. */
type Known = { key: string; rows: InvoiceItem[]; generation: number; log: ReadonlyMap<string, { change: FolderItemChange; generation: number }> };
/**
 * A snapshot can be read before a change and arrive after it, so a change waits for the
 * snapshot to show it, but only through this many newer snapshots: then the server's word stands.
 */
const KEEP_FOR = 2;

function replay({ rows, log }: Known) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let list = rows;
  for (const { change } of log.values()) if (!shownIn(byId, change)) list = applyChange(list, change);
  return list;
}

function rebase(known: Known, rows: InvoiceItem[], key: string): Known {
  const generation = known.generation + 1;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const log = new Map([...known.log].filter(([, entry]) => !shownIn(byId, entry.change) && generation - entry.generation < KEEP_FOR));
  return { key, rows, generation, log };
}

function record(known: Known, change: FolderItemChange): Known {
  const id = changedId(change);
  // Realtime deletes are not filtered by folder: an id this folder never had is not kept.
  if (change.type === "delete" && !known.log.has(id) && !known.rows.some((row) => row.id === id)) return known;
  // Arrival order is not version order (an echo can beat the action's answer): an upsert only
  // replaces an upsert of the same row that is strictly older. A delete, or an upsert after a
  // delete (a restore), always applies.
  const before = known.log.get(id)?.change;
  if (change.type === "upsert" && before?.type === "upsert") {
    const [incoming, existing] = [instant(change.item.updatedAt), instant(before.item.updatedAt)];
    if (incoming === null || (existing !== null && existing >= incoming)) return known;
  }
  const log = new Map(known.log);
  log.delete(id);
  log.set(id, { change, generation: known.generation });
  return { ...known, log };
}

/**
 * The folder's rows as the viewer sees them: the last server snapshot, plus saved local
 * changes and changes from other people that the snapshot does not show yet, with unsaved
 * local changes laid over the top. A snapshot only counts as new when its content changes,
 * so a caller may pass a fresh array on every render.
 */
export function useFolderItems(initial: InvoiceItem[]) {
  const key = useMemo(() => JSON.stringify(initial), [initial]);
  const [known, setKnown] = useState<Known>(() => ({ key, rows: initial, generation: 0, log: new Map() }));
  if (known.key !== key) setKnown(rebase(known, initial, key));
  const confirmed = useMemo(() => replay(known), [known]);
  const [items, applyOptimistic] = useOptimistic(confirmed, applyChange);
  const [, startTransition] = useTransition();
  const confirmedIds = useMemo(() => new Set(confirmed.map((row) => row.id)), [confirmed]);
  const latest = useRef(confirmed);
  useEffect(() => { latest.current = confirmed; }, [confirmed]);

  const confirm = (change: FolderItemChange) => setKnown((current) => record(current, change));
  /** The row as last confirmed, so a failed save leaves it as it was. */
  const revert = (change: FolderItemChange): FolderItemChange => {
    const id = changedId(change);
    const before = latest.current.find((row) => row.id === id);
    return before ? { type: "upsert", item: before } : { type: "delete", id };
  };
  /**
   * Shows `optimistic` until `save` answers, then keeps whatever `settle` says really happened.
   * React keeps optimistic state until every pending save is answered, so the outcome is laid
   * over it at once: a failed row does not linger while another save is still running.
   */
  const run = <T extends object>(optimistic: FolderItemChange, save: () => Promise<ActionResult<T>>, settle: (result: ActionResult<T>) => FolderItemChange | null) =>
    new Promise<ActionResult<T>>((resolve) => {
      startTransition(async () => {
        applyOptimistic(optimistic);
        const result: ActionResult<T> = await save().catch(failed);
        const change = settle(result);
        const outcome = change ?? revert(optimistic);
        startTransition(() => { if (change) confirm(change); applyOptimistic(outcome); });
        resolve(result);
      });
    });

  return {
    items,
    /** A row added here whose save has not been answered yet. */
    isSaving: (id: string) => !confirmedIds.has(id),
    /** Once saved, the row takes the server's timestamps, so its place and version follow the server's clock. */
    add: (item: InvoiceItem, save: () => Promise<ActionResult<SavedTimes>>) =>
      run({ type: "upsert", item }, save, (result) => result.ok ? { type: "upsert", item: withSavedTimes(item, result) } : null),
    /** A `conflict` means someone else deleted the row, so it leaves the list. */
    update: (item: InvoiceItem, save: () => Promise<ActionResult<SavedTimes>>) =>
      run({ type: "upsert", item }, save, (result) => result.ok ? { type: "upsert", item: withSavedTimes(item, result) }
        : result.error === "conflict" ? { type: "delete", id: item.id } : null),
    remove: (id: string, save: () => Promise<ActionResult>) =>
      run({ type: "delete", id }, save, (result) => result.ok ? { type: "delete", id } : null),
    /** Undo of a delete. The row may still carry the device's clock (an add not yet answered), so it is logged with the server's times. */
    restore: (item: InvoiceItem, save: () => Promise<ActionResult<SavedTimes>>) =>
      run({ type: "upsert", item }, save, (result) => result.ok ? { type: "upsert", item: withSavedTimes(item, result) } : null),
    applyRemote: confirm,
  };
}

/** Viewer's enabled currencies first (default first, catalog order), then everything else as it appears. */
function orderTotals(totals: CurrencyTotal[], enabled: readonly CurrencyDefinition[], defaultCurrency: string | null) {
  const order = [...enabled].sort((a, b) => Number(b.code === defaultCurrency) - Number(a.code === defaultCurrency)).map((c) => c.code);
  const rank = (code: string) => { const at = order.indexOf(code); return at < 0 ? order.length : at; };
  return totals.map((total, at) => ({ total, at })).sort((a, b) => rank(a.total.currency) - rank(b.total.currency) || a.at - b.at).map(({ total }) => total);
}

type Sheet = { mode: "edit"; id: string } | { mode: "rename" } | { mode: "deleteFolder" } | null;

const rowClass = "flex min-h-[60px] w-full items-center gap-3 px-3.5 py-3 text-start";
const shellButton = "bg-shell-foreground/12 text-shell-foreground hover:bg-shell-foreground/20 focus-visible:ring-shell-foreground/60";

/**
 * One folder: a total per currency at the top (never added together), the add form, then the
 * rows newest first. Everyone in the folder can add, edit and delete any row; only the owner
 * can rename or delete the folder.
 */
export function FolderView({ folder }: { folder: InvoiceFolderDetail }) {
  const t = useTranslations("Invoices");
  const router = useRouter();
  const { currencies, enabledCurrencies, defaultCurrency } = useAppData();
  const catalog = useMemo(() => indexCurrencies(currencies), [currencies]);
  const { items, isSaving, add, update, remove, restore, applyRemote } = useFolderItems(folder.items);
  const [sheet, setSheet] = useState<Sheet>(null);
  const close = () => setSheet(null);
  const nameField = useRef<HTMLInputElement>(null);
  // Rows whose removal by someone else was already announced while their edit was being saved.
  const announced = useRef(new Set<string>());
  // Set when the folder is gone for this viewer: nothing of it stays on screen while the list opens.
  const [lost, setLost] = useState(false);

  useLiveFolder(folder.id, {
    onItem: (change) => {
      if (change.type === "delete" && sheet?.mode === "edit" && sheet.id === change.id) {
        close();
        announced.current.add(change.id);
        toast.error(t("itemRemovedRemote"));
      }
      applyRemote(change);
    },
    // People and removal come with the refreshed page; a viewer who was removed is sent to the list by the page itself.
    onMembers: () => {},
    onLost: () => {
      // The owner's own delete: that sheet goes to the list when the server answers.
      if (sheet?.mode === "deleteFolder") return;
      setLost(true);
      router.replace({ pathname: "/invoices", query: { unavailable: "1" } });
    },
  });

  // The name follows the server, and a rename shows at once.
  const [serverName, setServerName] = useState(folder.name);
  const [name, setName] = useState(folder.name);
  if (serverName !== folder.name) { setServerName(folder.name); setName(folder.name); }

  const totals = orderTotals(totalsByCurrency(items), enabledCurrencies, defaultCurrency);
  const active = folder.members.filter((member) => !member.removed);
  const shared = active.length > 1;
  const people = new Map(active.map((member) => [member.userId, member]));
  const target = sheet?.mode === "edit" ? items.find((row) => row.id === sheet.id) : undefined;
  // The row being edited is gone: forget the sheet, so the row coming back (someone's Undo) does not reopen it.
  if (sheet?.mode === "edit" && !target) setSheet(null);

  const addedBy = (row: InvoiceItem): React.ReactNode => {
    if (row.createdBy === folder.viewerId) return t("addedByYou");
    const person = row.createdBy ? people.get(row.createdBy) : undefined;
    if (!person) return t("formerMember");
    return person.displayName ? <bdi>{person.displayName}</bdi> : t("unnamedMember");
  };

  const save = async (row: InvoiceItem, input: ItemEditInput) => {
    const next: InvoiceItem = { ...row, name: input.name, priceMinor: input.priceMinor,
      currency: input.currency ?? row.currency, decimalPlaces: input.decimalPlaces ?? row.decimalPlaces };
    announced.current.delete(row.id);
    const result = await update(next, () => updateItem(row.id, input));
    if (result.ok) { close(); toast(t("itemSaved")); }
    else if (result.error === "conflict") {
      // Already told (the removal arrived while this save was running): one notice, not two.
      close();
      if (!announced.current.has(row.id)) toast.error(t("itemRemoved"));
    }
    announced.current.delete(row.id);
    return result;
  };

  const undo = (row: InvoiceItem) => {
    void restore(row, () => restoreItem(row.id)).then((result) => {
      if (result.ok) return;
      // Whatever the reason (the 10-minute window passed, the id was taken, the call failed), the row did not come back.
      toast.error(t("undoExpired"));
    });
  };

  // No confirmation: the row goes at once and Undo brings it back. A row already gone counts as deleted.
  const removeRow = (row: InvoiceItem) => {
    close();
    void remove(row.id, () => deleteItem(row.id)).then((result) => {
      if (!result.ok) { toast.error(t(invoiceErrorKey(result.error))); return; }
      // The server keeps the row for 10 minutes, so the Undo stays up long enough to be read and used.
      toast(t("itemDeleted"), { duration: UNDO_MS, action: { label: t("undo"), onClick: () => undo(row) } });
      // The sheet is gone with the row: leave focus at the add form instead of on the page.
      const active = document.activeElement;
      if (!active || active === document.body) nameField.current?.focus();
    });
  };

  if (lost) return null;

  return <>
    <ScreenHeader title={name}>
      {totals.length ? <>
        <p className="flex flex-wrap justify-between gap-x-3 text-[13px] text-shell-muted">
          <span>{t("folderTotal")}</span><span>{t("itemCount", { count: items.length })}</span>
        </p>
        <ul aria-label={t("totalsLabel")} className="mt-1 flex flex-col gap-1">
          {totals.map((total, index) => <li key={`${total.currency}:${total.decimalPlaces}`}>
            {total.minor === null
              ? <span className="text-[17px] text-shell-foreground">{t.rich("totalTooLarge", { currency: total.currency, bdi: (chunks) => <bdi dir="ltr">{chunks}</bdi> })}</span>
              : <Amount minor={total.minor} currency={rowDefinition(total, catalog)}
                className={`block max-w-full whitespace-normal! [overflow-wrap:anywhere] font-bold tracking-[-0.025em] text-shell-foreground ${index === 0 ? "text-[40px] leading-[1.1]" : "text-[28px] leading-tight"}`} />}
          </li>)}
        </ul>
      </> : <p className="text-[15px] text-shell-muted">{t("folderEmptyLead")}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <ShareSheet folder={folder} />
        {folder.isOwner ? <Button size="sm" className={shellButton} onClick={() => setSheet({ mode: "rename" })}><Pencil aria-hidden />{t("renameFolder")}</Button> : null}
      </div>
    </ScreenHeader>
    <PageBody>
      <Link href="/invoices" className="-my-3 inline-flex min-h-11 items-center gap-1 self-start rounded-lg text-[15px] text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
        <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />{t("backToFolders")}
      </Link>
      <AddInvoiceItemForm nameRef={nameField} folderId={folder.id} viewerId={folder.viewerId} onAdd={(row, input) => add(row, () => addItem(input))} />
      {items.length ? (
        <ul aria-label={t("itemsLabel")} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {items.map((row) => {
            const saving = isSaving(row.id);
            const body = <>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="min-w-0 font-medium [overflow-wrap:anywhere]"><bdi>{row.name}</bdi></span>
                {shared ? <span className="min-w-0 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{addedBy(row)}</span> : null}
              </span>
              <Amount minor={row.priceMinor} currency={rowDefinition(row, catalog)} className="shrink-0 text-[15px] font-semibold" />
            </>;
            return <li key={row.id} aria-busy={saving || undefined}>
              {saving
                ? <div className={`${rowClass} opacity-70`}>{body}</div>
                : <button type="button" onClick={() => setSheet({ mode: "edit", id: row.id })}
                  className={`${rowClass} hover:bg-accent/50 active:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring`}>{body}</button>}
            </li>;
          })}
        </ul>
      ) : <EmptyState title={t("emptyItemsTitle")} body={t("emptyItemsBody")} />}
      {folder.isOwner ? <Button variant="destructive" className="self-start" onClick={() => setSheet({ mode: "deleteFolder" })}><Trash2 aria-hidden />{t("deleteFolder")}</Button> : null}
    </PageBody>
    {target ? <InvoiceItemSheet key={target.id} item={target} onClose={close} onSave={(input) => save(target, input)} onDelete={() => removeRow(target)} /> : null}
    {sheet?.mode === "rename" ? <RenameSheet folderId={folder.id} name={name} onClose={close} onRenamed={(next) => { setName(next); close(); toast(t("folderRenamed")); }} /> : null}
    {sheet?.mode === "deleteFolder" ? <DeleteFolderSheet folderId={folder.id} name={name} onClose={close} onDeleted={() => { router.push("/invoices"); router.refresh(); }} /> : null}
  </>;
}

function RenameSheet({ folderId, name, onClose, onRenamed }: { folderId: string; name: string; onClose: () => void; onRenamed: (name: string) => void }) {
  const t = useTranslations("Invoices");
  const formId = useId();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const parsed = folderRenameSchema.safeParse({ name: value });
  const submit = () => {
    if (!parsed.success || pending) return;
    const input = parsed.data;
    setError(null);
    startTransition(async () => {
      const result = await renameFolder(folderId, input).catch(failed);
      if (result.ok) onRenamed(input.name); else setError(t(invoiceErrorKey(result.error)));
    });
  };
  return <SheetShell open title={t("renameTitle")} dismissible={!pending} onOpenChange={(open) => !open && onClose()}
    footer={<Button variant="action" size="lg" className="w-full" form={formId} type="submit" loading={pending} disabled={!parsed.success}>{t("saveName")}</Button>}>
    <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); submit(); }} className="flex flex-col gap-4">
      <TextField label={t("folderName")} value={value} onChange={(event) => setValue(event.target.value)} maxLength={MAX_NAME} autoComplete="off" required />
      {error ? <p role="alert" className="text-sm text-over">{error}</p> : null}
    </form>
  </SheetShell>;
}

function DeleteFolderSheet({ folderId, name, onClose, onDeleted }: { folderId: string; name: string; onClose: () => void; onDeleted: () => void }) {
  const t = useTranslations("Invoices");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = () => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteFolder(folderId).catch(failed);
      if (result.ok) onDeleted(); else setError(t(invoiceErrorKey(result.error)));
    });
  };
  return <ConfirmSheet open tone="danger" title={t("confirmDeleteFolder")} onOpenChange={(open) => !open && !pending && onClose()}
    confirmLabel={t("deleteFolder")} cancelLabel={t("keepFolder")} pending={pending} onConfirm={confirm}>
    <p className="font-medium [overflow-wrap:anywhere]"><bdi>{name}</bdi></p>
    <p>{t("deleteFolderHelp")}</p>
    {error ? <p role="alert" className="text-sm text-over">{error}</p> : null}
  </ConfirmSheet>;
}
