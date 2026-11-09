"use client";

import { useEffect, useOptimistic, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, FolderX, Plus, Users } from "lucide-react";
import { EmptyState } from "@/components/shell/empty-state";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { createFolder } from "@/features/invoices/actions";
import { invoiceErrorKey } from "@/features/invoices/errors";
import { folderCreateSchema, MAX_NAME, type InvoiceFolderSummary } from "@/features/invoices/schema";
import { Link } from "@/i18n/navigation";
import { FolderTotals } from "./folder-totals";
import type { ActionResult } from "@/lib/supabase/action";

const subscribeNoop = () => () => {};

const rowClass = "flex min-h-[72px] items-center gap-3 px-3.5 py-3";

/**
 * The folders you own and the ones you joined. Every total is per currency and never mixed;
 * a currency you have not enabled still shows as its own code. A new folder appears at once
 * (without a link until it is saved), and if saving fails its name comes back with the reason;
 * a retry keeps the same id only while the name is unchanged and the failure was not a `conflict`.
 * `unavailable` is set when a folder the viewer had open is gone for them (removed, left or deleted).
 */
export function FoldersView({ folders, unavailable = false }: { folders: InvoiceFolderSummary[]; unavailable?: boolean }) {
  const t = useTranslations("Invoices");
  // The notice is filled in after the page is on screen (false while the server renders and the
  // page hydrates), so its live region exists empty first and screen readers announce the text.
  const hydrated = useSyncExternalStore(subscribeNoop, () => true, () => false);
  // Said once: a reload or a copied address does not repeat it.
  useEffect(() => {
    if (!unavailable) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("unavailable");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [unavailable]);
  const [list, addOptimistic] = useOptimistic(folders, (state, added: InvoiceFolderSummary) => [added, ...state]);
  // Folders sent but not yet answered: shown, but not opened (the folder page would not find them yet).
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());

  const [name, setName] = useState("");
  const [fresh, setFresh] = useState(() => crypto.randomUUID());
  const [retry, setRetry] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);
  const id = retry && retry.name === name ? retry.id : fresh;
  const parsed = folderCreateSchema.safeParse({ id, name });

  const track = (folderId: string, on: boolean) => setSaving((current) => {
    const next = new Set(current);
    if (on) next.add(folderId); else next.delete(folderId);
    return next;
  });

  const submit = () => {
    if (!parsed.success) return;
    const input = parsed.data;
    const draft = name;
    setName(""); setFresh(crypto.randomUUID()); setRetry(null); setError(null);
    nameRef.current?.focus();
    // Outside the transition, which stays open until the save is answered.
    track(input.id, true);
    startTransition(async () => {
      addOptimistic({ id: input.id, name: input.name, isOwner: true, memberCount: 1, itemCount: 0, totals: [] });
      const result = await createFolder(input).catch((): ActionResult => ({ ok: false, error: "failed" }));
      track(input.id, false);
      if (!result.ok) {
        // Put the text back only if the field is still empty. A retry of the same text keeps the id it was sent
        // under, so it cannot save twice; edited text, or a taken id (`conflict`), gets the fresh id.
        if (!nameRef.current?.value) {
          setName(draft);
          if (result.error !== "conflict") setRetry({ id: input.id, name: draft });
        }
        setError(t(invoiceErrorKey(result.error)));
      }
    });
  };

  return <>
    <ScreenHeader title={t("title")}>
      <p className="text-[15px] text-shell-muted">{t("help")}</p>
    </ScreenHeader>
    <PageBody>
      {unavailable ? <div role="status" className="empty:-mb-6">
        {hydrated ? <p className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3 text-[15px]">
          <FolderX aria-hidden className="size-4 shrink-0 text-muted-foreground" />{t("folderLost")}
        </p> : null}
      </div> : null}
      <form noValidate onSubmit={(event) => { event.preventDefault(); submit(); }} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5">
        <TextField ref={nameRef} label={t("folderName")} placeholder={t("folderNamePlaceholder")} value={name} maxLength={MAX_NAME}
          onChange={(event) => setName(event.target.value)} autoComplete="off" enterKeyHint="done" />
        {error ? <p role="alert" className="text-sm text-over">{error}</p> : null}
        <Button type="submit" disabled={!parsed.success}><Plus aria-hidden />{t("createFolder")}</Button>
      </form>
      {list.length ? (
        <ul aria-label={t("foldersLabel")} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {list.map((folder) => {
            const pending = saving.has(folder.id);
            const shared = !folder.isOwner || folder.memberCount > 1;
            const body = <>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-medium break-words"><bdi>{folder.name}</bdi></span>
                <span className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted-foreground">
                  <span>{t("itemCount", { count: folder.itemCount })}</span>
                  {shared ? <span className="inline-flex items-center gap-1"><Users aria-hidden className="size-3.5" />{folder.isOwner ? t("shared") : t("sharedWithYou")}</span> : null}
                </span>
                <FolderTotals totals={folder.totals} className="text-[15px] font-semibold" />
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
            </>;
            return <li key={folder.id} aria-busy={pending || undefined}>
              {pending
                ? <div className={`${rowClass} opacity-70`}>{body}</div>
                : <Link href={`/invoices/${folder.id}`} className={`${rowClass} hover:bg-accent/50 active:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring`}>{body}</Link>}
            </li>;
          })}
        </ul>
      ) : <EmptyState title={t("emptyTitle")} body={t("emptyBody")} />}
    </PageBody>
  </>;
}
