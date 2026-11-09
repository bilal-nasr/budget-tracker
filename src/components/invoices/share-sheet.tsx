"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Copy, LogOut, Share2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { createOrRotateLink, disableLink, leaveFolder, removeMember, setMyName } from "@/features/invoices/actions";
import { invoiceErrorKey } from "@/features/invoices/errors";
import type { InvoiceFolderDetail } from "@/features/invoices/queries";
import { MAX_PERSON_NAME, personNameSchema, type InvoiceMember } from "@/features/invoices/schema";
import type { ActionResult } from "@/lib/supabase/action";
import { useRouter } from "@/i18n/navigation";

const shellButton = "bg-shell-foreground/12 text-shell-foreground hover:bg-shell-foreground/20 focus-visible:ring-shell-foreground/60";

/**
 * Runs one request at a time and keeps its reason when it fails. A request that did not answer
 * (offline, dropped) counts as `failed`; pressing the same button again repeats the same request,
 * and every request here is safe to repeat.
 */
function useAction() {
  const t = useTranslations("Invoices");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Set synchronously, so a double tap cannot send twice.
  const busy = useRef(false);
  const run = <T extends object>(call: () => Promise<ActionResult<T>>, onDone: (result: { ok: true } & T) => void) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    startTransition(async () => {
      const result = await call().catch((): ActionResult<T> => ({ ok: false, error: "failed" }));
      busy.current = false;
      if (result.ok) onDone(result); else setError(t(invoiceErrorKey(result.error)));
    });
  };
  return { run, pending, error };
}

const Problem = ({ message }: { message: string | null }) => message ? <p role="alert" className="text-sm text-over">{message}</p> : null;

type Confirm = { kind: "replace" } | { kind: "turnOff" } | { kind: "remove"; member: InvoiceMember } | { kind: "leave" };

/**
 * The Share button for the folder header and the sheet behind it: the invite link (owner only),
 * the people in the folder, and for everyone else their own name and Leave. Names only, never emails.
 */
export function ShareSheet({ folder }: { folder: InvoiceFolderDetail }) {
  const t = useTranslations("Invoices");
  const [open, setOpen] = useState(false);
  return <>
    <Button size="sm" className={shellButton} onClick={() => setOpen(true)}><Share2 aria-hidden />{t("share")}</Button>
    {open ? <ShareContent folder={folder} onClose={() => setOpen(false)} /> : null}
  </>;
}

function ShareContent({ folder, onClose }: { folder: InvoiceFolderDetail; onClose: () => void }) {
  const t = useTranslations("Invoices");
  const router = useRouter();
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  // The link, people and my name follow the server, and a change made here shows at once.
  const [serverLink, setServerLink] = useState(folder.link);
  const [link, setLink] = useState(folder.link);
  if (serverLink !== folder.link) { setServerLink(folder.link); setLink(folder.link); }
  const [removed, setRemoved] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const people = folder.members
    .filter((member) => !member.removed && !removed.includes(member.userId))
    .map((member) => ({ ...member, displayName: names[member.userId] ?? member.displayName }));
  const me = people.find((member) => member.userId === folder.viewerId);
  const needsOwnerName = folder.isOwner && !me?.displayName;
  const nameOf = (member: InvoiceMember) => member.displayName ?? t(member.isOwner ? "ownerLabel" : "unnamedMember");

  return <>
    <SheetShell open title={t("shareTitle")} onOpenChange={(next) => !next && onClose()}>
      <div className="flex flex-col gap-6">
        {folder.isOwner
          ? <LinkSection folderId={folder.id} folderName={folder.name} link={link} needsOwnerName={needsOwnerName}
            onLink={(token, ownerName) => {
              setLink(token);
              if (ownerName) setNames((current) => ({ ...current, [folder.viewerId]: ownerName }));
              router.refresh();
            }}
            onReplace={() => setConfirm({ kind: "replace" })} onTurnOff={() => setConfirm({ kind: "turnOff" })} />
          : <p className="text-[15px] text-muted-foreground">{t("memberNote")}</p>}

        <section aria-labelledby={`${folder.id}-people`} className="flex flex-col gap-2">
          <h3 id={`${folder.id}-people`} className="text-sm font-medium">{t("membersHeading")}</h3>
          <ul aria-label={t("membersLabel")} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
            {people.map((member) => {
              const you = member.userId === folder.viewerId;
              const tags = [you ? t("youLabel") : null, member.isOwner && member.displayName ? t("ownerLabel") : null].filter(Boolean);
              return <li key={member.userId} className="flex min-h-14 items-center gap-2 ps-3.5 pe-1.5">
                <span className="flex min-w-0 flex-1 flex-col py-2">
                  <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                    {member.displayName ? <bdi>{member.displayName}</bdi> : nameOf(member)}
                  </span>
                  {tags.length ? <span className="text-[13px] text-muted-foreground">{tags.join(" · ")}</span> : null}
                </span>
                {folder.isOwner && !you
                  ? <Button variant="ghost" size="sm" className="shrink-0 text-destructive hover:text-destructive" aria-label={t("removePersonNamed", { name: nameOf(member) })}
                    onClick={() => setConfirm({ kind: "remove", member })}><UserMinus aria-hidden />{t("removePerson")}</Button>
                  : null}
              </li>;
            })}
          </ul>
        </section>

        {/* Everyone can change their own name later; the owner is asked for it the first time they share (above). */}
        {folder.isOwner && !me?.displayName ? null : <NameForm folderId={folder.id} current={me?.displayName ?? ""} onSaved={(name) => {
          setNames((current) => ({ ...current, [folder.viewerId]: name }));
          toast(t("nameSaved"));
          router.refresh();
        }} />}
        {folder.isOwner ? null
          : <Button variant="outline" className="self-start text-destructive hover:text-destructive" onClick={() => setConfirm({ kind: "leave" })}><LogOut aria-hidden className="rtl:-scale-x-100" />{t("leaveFolder")}</Button>}
      </div>
    </SheetShell>

    {confirm?.kind === "replace" ? (
      <ConfirmAction title={t("replaceTitle")} confirmLabel={t("replaceConfirm")} cancelLabel={t("keepLink")}
        call={() => createOrRotateLink(folder.id)} onClose={() => setConfirm(null)}
        onDone={({ token }) => { setLink(token); setConfirm(null); toast(t("linkReplaced")); router.refresh(); }}>
        <p>{t("replaceHelp")}</p>
      </ConfirmAction>
    ) : null}
    {confirm?.kind === "turnOff" ? (
      <ConfirmAction title={t("turnOffTitle")} confirmLabel={t("turnOffConfirm")} cancelLabel={t("keepLinkOn")}
        call={() => disableLink(folder.id)} onClose={() => setConfirm(null)}
        onDone={() => { setLink(null); setConfirm(null); toast(t("linkTurnedOff")); router.refresh(); }}>
        <p>{t("turnOffHelp")}</p>
      </ConfirmAction>
    ) : null}
    {confirm?.kind === "remove" ? (
      <ConfirmAction tone="danger" title={t("removeTitle")} confirmLabel={t("removePerson")} cancelLabel={t("keepPerson")}
        call={() => removeMember(folder.id, confirm.member.userId)} onClose={() => setConfirm(null)}
        onDone={() => { setRemoved((current) => [...current, confirm.member.userId]); setConfirm(null); toast(t("personRemoved")); router.refresh(); }}>
        <p className="font-medium [overflow-wrap:anywhere]"><bdi>{nameOf(confirm.member)}</bdi></p>
        <p>{t("removeHelp")}</p>
      </ConfirmAction>
    ) : null}
    {confirm?.kind === "leave" ? (
      <ConfirmAction tone="danger" title={t("leaveTitle")} confirmLabel={t("leaveFolder")} cancelLabel={t("stayInFolder")}
        call={() => leaveFolder(folder.id)} onClose={() => setConfirm(null)}
        onDone={() => { router.push("/invoices"); router.refresh(); }}>
        <p>{t("leaveHelp")}</p>
      </ConfirmAction>
    ) : null}
  </>;
}

/**
 * Ask, then do. A failure stays here with its reason, and confirming again repeats the same
 * request. After a success the confirm button stays disabled: `onDone` may be a navigation that
 * takes a moment (Leave), and the request must not be sent a second time meanwhile.
 */
function ConfirmAction<T extends object>({ title, confirmLabel, cancelLabel, tone, call, onDone, onClose, children }: {
  title: string; confirmLabel: string; cancelLabel: string; tone?: "default" | "danger";
  call: () => Promise<ActionResult<T>>; onDone: (result: { ok: true } & T) => void; onClose: () => void; children: React.ReactNode;
}) {
  const action = useAction();
  const [finished, setFinished] = useState(false);
  const pending = action.pending || finished;
  return <ConfirmSheet open tone={tone} title={title} confirmLabel={confirmLabel} cancelLabel={cancelLabel} pending={pending}
    onOpenChange={(next) => !next && !pending && onClose()}
    onConfirm={() => { if (!finished) action.run(call, (result) => { setFinished(true); onDone(result); }); }}>
    {children}
    <Problem message={action.error} />
  </ConfirmSheet>;
}

function LinkSection({ folderId, folderName, link, needsOwnerName, onLink, onReplace, onTurnOff }: {
  folderId: string; folderName: string; link: string | null; needsOwnerName: boolean;
  onLink: (token: string, ownerName?: string) => void; onReplace: () => void; onTurnOff: () => void;
}) {
  const t = useTranslations("Invoices");
  const locale = useLocale();
  const create = useAction();
  const formId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  // Toasts sit behind an open sheet, so the outcome of Copy is also said here. It belongs to the
  // link it was said about: a replaced link starts without it.
  const [said, setSaid] = useState<{ message: string; link: string } | null>(null);
  const note = said && said.link === link ? said.message : null;
  const say = (message: string) => { if (link) setSaid({ message, link }); toast(message); };
  const parsedName = personNameSchema.safeParse(name);

  if (!link) {
    const submit = () => {
      if (needsOwnerName && !parsedName.success) return;
      const ownerName = needsOwnerName && parsedName.success ? parsedName.data : undefined;
      create.run(() => ownerName ? createOrRotateLink(folderId, ownerName) : createOrRotateLink(folderId), ({ token }) => {
        onLink(token, ownerName);
        toast(t("linkCreated"));
      });
    };
    return <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); submit(); }} className="flex flex-col gap-4">
      <p className="text-[15px] text-muted-foreground">{t("shareHelp")}</p>
      {needsOwnerName
        ? <TextField label={t("joinName")} description={t("joinNameHelp")} placeholder={t("joinNamePlaceholder")} value={name}
          onChange={(event) => setName(event.target.value)} maxLength={MAX_PERSON_NAME} autoComplete="nickname" enterKeyHint="go" disabled={create.pending} required />
        : null}
      <Button type="submit" size="lg" className="w-full" loading={create.pending} disabled={needsOwnerName && !parsedName.success}>{t("createLink")}</Button>
      <Problem message={create.error} />
    </form>;
  }

  const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
  const url = `${window.location.origin}${base}/${locale}/invoices/join/${link}`;
  const canShare = typeof navigator.share === "function";
  const select = () => { field.current?.focus(); field.current?.select(); say(t("linkSelected")); };
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(url);
      say(t("linkCopied"));
    } catch { select(); }
  };
  const send = async () => {
    try { await navigator.share({ title: folderName, text: t("shareMessage", { name: folderName }), url }); }
    catch { /* closing the device share sheet is not an error */ }
  };

  return <div className="flex flex-col gap-3">
    <p className="text-[15px] text-muted-foreground">{t("shareHelp")}</p>
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <label htmlFor={`${formId}-link`} className="text-sm font-medium">{t("linkLabel")}</label>
        <span role="status" className="text-[13px] text-muted-foreground">{note}</span>
      </div>
      <input ref={field} id={`${formId}-link`} readOnly dir="ltr" value={url} autoComplete="off" spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
        className="h-12 w-full min-w-0 rounded-lg border border-input bg-background px-3.5 text-start text-base text-foreground select-all outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" />
    </div>
    <div className="flex flex-wrap gap-2">
      <Button className="min-w-0 flex-1" onClick={() => void copy()}><Copy aria-hidden />{t("copyLink")}</Button>
      {canShare ? <Button variant="outline" className="min-w-0 flex-1" onClick={() => void send()}><Share2 aria-hidden />{t("shareLink")}</Button> : null}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={onReplace}>{t("replaceLink")}</Button>
      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onTurnOff}>{t("turnOffLink")}</Button>
    </div>
  </div>;
}

/** Change my name in this folder. */
function NameForm({ folderId, current, onSaved }: { folderId: string; current: string; onSaved: (name: string) => void }) {
  const t = useTranslations("Invoices");
  const action = useAction();
  const [name, setName] = useState(current);
  const [saved, setSaved] = useState(false);
  const parsed = personNameSchema.safeParse(name);
  const changed = parsed.success && parsed.data !== current;
  const submit = () => {
    if (!parsed.success || !changed) return;
    const next = parsed.data;
    action.run(() => setMyName(folderId, next), () => { setSaved(true); onSaved(next); });
  };
  return <form noValidate onSubmit={(event) => { event.preventDefault(); submit(); }} className="flex flex-col gap-3">
    <TextField label={t("joinName")} description={t("joinNameHelp")} value={name} onChange={(event) => { setName(event.target.value); setSaved(false); }}
      maxLength={MAX_PERSON_NAME} autoComplete="nickname" enterKeyHint="done" disabled={action.pending} />
    <Button type="submit" variant="outline" className="self-start" loading={action.pending} disabled={!changed}>{t("saveName")}</Button>
    <Problem message={action.error} />
    <p role="status" className="text-sm text-muted-foreground empty:hidden">{saved && !action.error ? t("nameSaved") : null}</p>
  </form>;
}
