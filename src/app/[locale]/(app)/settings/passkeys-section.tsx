"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import {
  addPasskey,
  listPasskeys,
  passkeysConfigured,
  passkeysSupported,
  removePasskey,
  renamePasskey,
  type PasskeyItem,
} from "@/features/passkeys/client";
import type { PasskeyErrorKind } from "@/features/passkeys/errors";

const subscribeNoop = () => () => {};

function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-LB-u-nu-latn" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/**
 * Settings > Sign-in keys. Lists the keys on the account, adds one from this
 * device (the phone shows its own fingerprint/face/screen-lock prompt), and
 * renames or removes them. Passwords keep working next to the keys.
 */
export function PasskeysSection() {
  const t = useTranslations("Settings");
  const locale = useLocale();
  const available = useSyncExternalStore(subscribeNoop, passkeysConfigured, () => false);
  const supported = useSyncExternalStore(subscribeNoop, passkeysSupported, () => false);
  const [items, setItems] = useState<PasskeyItem[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<PasskeyItem | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [removing, setRemoving] = useState<PasskeyItem | null>(null);
  const [busy, setBusy] = useState(false);

  const words = useCallback(
    (kind: PasskeyErrorKind) =>
      kind === "duplicate"
        ? t("passkeyDuplicate")
        : kind === "domain"
          ? t("passkeyDomain")
          : kind === "unsupported"
            ? t("passkeyUnsupported")
            : t("passkeyFailed"),
    [t],
  );

  const reload = useCallback(async () => {
    const result = await listPasskeys();
    if (result.ok) {
      setItems(result.data);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!available) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list from the auth server once on mount
    void reload();
  }, [available, reload]);

  if (!available) return null;

  const add = async () => {
    if (adding) return;
    setAdding(true);
    const result = await addPasskey();
    setAdding(false);
    if (result.ok) {
      toast.success(t("passkeyAdded"));
      await reload();
    } else if (result.error !== "cancelled") {
      toast.error(words(result.error));
    }
  };

  const saveName = async () => {
    if (!renaming || busy) return;
    const name = nameDraft.trim();
    if (name === "") return;
    setBusy(true);
    const result = await renamePasskey(renaming.id, name);
    setBusy(false);
    if (result.ok) {
      setRenaming(null);
      await reload();
    } else {
      toast.error(words(result.error));
    }
  };

  const remove = async () => {
    if (!removing || busy) return;
    setBusy(true);
    const result = await removePasskey(removing.id);
    setBusy(false);
    if (result.ok) {
      setRemoving(null);
      toast.success(t("passkeyRemoved"));
      await reload();
    } else {
      toast.error(words(result.error));
    }
  };

  return (
    <section aria-labelledby="s-keys" className="flex flex-col gap-2">
      <h2 id="s-keys" className="text-[17px] font-semibold">{t("passkeys")}</h2>
      <p className="text-[13px] text-muted-foreground">{t("passkeysHelp")}</p>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {items === null && !loadFailed ? (
          <div className="flex min-h-16 items-center gap-3 px-4 py-3" aria-hidden>
            <Skeleton className="size-5 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ) : null}
        {loadFailed ? (
          <p role="alert" className="px-4 py-3 text-[15px] text-over">{t("passkeysLoadFailed")}</p>
        ) : null}
        {items?.length === 0 ? (
          <p className="px-4 py-3 text-[15px] text-muted-foreground">{t("passkeysEmpty")}</p>
        ) : null}
        {items?.map((item) => (
          <div key={item.id} className="flex min-h-16 items-center gap-1 ps-4 pe-1">
            <KeyRound aria-hidden className="me-2 size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 py-3">
              <span className="block truncate font-medium"><bdi>{item.name ?? t("passkeyUnnamed")}</bdi></span>
              <span className="block truncate text-[13px] text-muted-foreground">
                {t("passkeyAddedOn", { date: formatDate(item.createdAt, locale) })}
                {" · "}
                {item.lastUsedAt ? t("passkeyLastUsed", { date: formatDate(item.lastUsedAt, locale) }) : t("passkeyNeverUsed")}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("passkeyRename", { name: item.name ?? t("passkeyUnnamed") })}
              onClick={() => {
                setNameDraft(item.name ?? "");
                setRenaming(item);
              }}
            >
              <Pencil aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("passkeyRemove", { name: item.name ?? t("passkeyUnnamed") })}
              onClick={() => setRemoving(item)}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
      </div>

      {supported ? (
        <Button variant="outline" size="lg" loading={adding} onClick={add} className="w-full">
          <Plus aria-hidden />
          {t("passkeyAdd")}
        </Button>
      ) : (
        <p className="text-[13px] text-muted-foreground">{t("passkeyUnsupported")}</p>
      )}

      <SheetShell
        open={renaming !== null}
        onOpenChange={(open) => { if (!open) setRenaming(null); }}
        title={t("passkeyRenameTitle")}
        footer={
          <Button size="lg" variant="action" loading={busy} disabled={nameDraft.trim() === ""} onClick={saveName} className="w-full">
            {t("passkeySave")}
          </Button>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveName();
          }}
        >
          <TextField
            label={t("passkeyName")}
            value={nameDraft}
            maxLength={120}
            autoComplete="off"
            onChange={(event) => setNameDraft(event.target.value)}
          />
        </form>
      </SheetShell>

      <ConfirmSheet
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null); }}
        title={t("passkeyRemoveTitle")}
        confirmLabel={t("passkeyRemoveConfirm")}
        cancelLabel={t("passkeyCancel")}
        onConfirm={remove}
        pending={busy}
        tone="danger"
      >
        <p>{t("passkeyRemoveBody", { name: removing?.name ?? t("passkeyUnnamed") })}</p>
      </ConfirmSheet>
    </section>
  );
}
