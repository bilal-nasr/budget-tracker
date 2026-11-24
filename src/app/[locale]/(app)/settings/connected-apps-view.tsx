"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppWindow, Check, ChevronDown, Copy, Plug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { revokeConnectedApp } from "@/features/connect/actions";
import type { ConnectedApp } from "@/features/connect/grants";

function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-LB-u-nu-latn" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/**
 * One value to paste into the assistant app: label, the value (always left to right), a Copy
 * button named for what it copies. If the clipboard cannot be used (a plain http address, say),
 * the value is selected and a hint says to copy it by hand.
 */
function CopyField({ label, value, copyLabel }: { label: React.ReactNode; value: string; copyLabel: string }) {
  const t = useTranslations("Settings.connectedApps");
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef<HTMLElement | null>(null);

  const copy = async () => {
    setFailed(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(value);
    } catch {
      setCopied(false);
      setFailed(true);
      // Ready for a manual copy: the whole value is selected.
      try {
        if (valueRef.current) window.getSelection()?.selectAllChildren(valueRef.current);
      } catch {
        // Selection is a convenience only.
      }
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="col-span-2 mt-2.5">
      <div className="flex min-h-5 items-center justify-between gap-2 text-[13px] leading-[1.4] text-muted-foreground">
        <span>{label}</span>
        <span aria-live="polite" className={copied ? "inline-flex items-center gap-1 font-medium text-primary" : "sr-only"}>
          {copied ? (
            <>
              <Check aria-hidden className="size-3.5" strokeWidth={2.4} />
              {t("copied")}
            </>
          ) : null}
        </span>
      </div>
      <div className="mt-1 flex min-h-12 items-stretch rounded-xl border border-border bg-background">
        <bdi
          ref={valueRef}
          dir="ltr"
          className="min-w-0 flex-1 px-3 py-[11px] text-start text-[15px] leading-normal font-medium tabular-nums [overflow-wrap:anywhere] select-all rtl:text-end"
        >
          {value}
        </bdi>
        <button
          type="button"
          onClick={copy}
          aria-label={copyLabel}
          className={`grid min-h-[46px] w-[46px] flex-none cursor-pointer place-items-center rounded-e-[11px] border-s border-border outline-none hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${copied ? "bg-accent text-primary" : "text-foreground"}`}
        >
          {copied ? <Check aria-hidden className="size-[18px]" strokeWidth={2.4} /> : <Copy aria-hidden className="size-[18px]" />}
        </button>
      </div>
      <p aria-live="polite" className={failed ? "mt-1.5 text-[13px] leading-[1.4] text-muted-foreground" : "sr-only"}>
        {failed ? t("copyFailed") : null}
      </p>
    </div>
  );
}

/**
 * Settings > Connected apps: the assistant apps the person approved (each with Remove), and the
 * "Connect Claude" help with the connector address and app id. Data comes from the Server
 * Component above; Remove is optimistic (the row leaves at once, comes back if it failed).
 * `apps` is null when the list could not be loaded.
 */
export function ConnectedAppsView({
  apps,
  address,
  appIds,
}: {
  apps: ConnectedApp[] | null;
  address: string;
  appIds: { clientId: string; name: string }[];
}) {
  const t = useTranslations("Settings.connectedApps");
  const locale = useLocale();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  // The sheet keeps its app while it slides closed, so its words do not blank out.
  const [removing, setRemoving] = useState<ConnectedApp | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Open only when nothing was connected on arrival; removing the last app later must not make the page jump.
  const [startOpen] = useState(() => (apps?.length ?? 0) === 0);

  const shown = apps?.filter((app) => !hidden.has(app.clientId)) ?? null;
  const labelOf = (app: ConnectedApp) => app.name || t("unnamedApp");
  const bdi = (chunks: React.ReactNode) => <bdi>{chunks}</bdi>;

  const setGone = (clientId: string, gone: boolean) =>
    setHidden((current) => {
      const next = new Set(current);
      if (gone) next.add(clientId);
      else next.delete(clientId);
      return next;
    });

  const confirmRemove = async () => {
    const app = removing;
    if (!app) return;
    setSheetOpen(false);
    setGone(app.clientId, true);
    const result = await revokeConnectedApp(app.clientId).catch(() => ({ ok: false as const, error: "failed" as const }));
    if (result.ok) {
      toast.success(t("removed"));
    } else {
      setGone(app.clientId, false);
      toast.error(t("removeFailed"));
    }
  };

  return (
    <section aria-labelledby="s-connected-apps" className="flex flex-col gap-2">
      <h2 id="s-connected-apps" className="text-[17px] font-semibold">{t("title")}</h2>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {shown === null ? (
          <p role="alert" className="px-4 py-3 text-[15px] text-over">{t("loadFailed")}</p>
        ) : shown.length === 0 ? (
          <p className="flex min-h-[68px] items-center px-4 py-3 text-[15px] text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((app) => (
              <li key={app.clientId} className="flex min-h-[68px] items-center gap-3 ps-3.5 pe-1.5">
                <span aria-hidden className="grid size-10 flex-none place-items-center rounded-md bg-secondary text-primary">
                  <AppWindow className="size-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1 py-3">
                  <span className="block truncate font-medium"><bdi>{labelOf(app)}</bdi></span>
                  {app.grantedAt ? (
                    <span className="block truncate text-[13px] leading-[1.4] text-muted-foreground">
                      {t.rich("approvedOn", { date: formatDate(app.grantedAt, locale), bdi })}
                    </span>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  aria-label={t("removeNamed", { name: labelOf(app) })}
                  onClick={() => {
                    setRemoving(app);
                    setSheetOpen(true);
                  }}
                >
                  {t("remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details open={startOpen} className="group overflow-hidden rounded-xl border border-border bg-card">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 text-base font-medium outline-none hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <Plug aria-hidden className="size-5 flex-none text-primary" />
          <span>{t.rich("howTitle", { bdi })}</span>
          <ChevronDown aria-hidden className="ms-auto size-4 flex-none text-muted-foreground transition-transform duration-200 ease-out group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="border-t border-border px-4 pt-0.5 pb-[18px]">
          <ol className="m-0 list-none p-0">
            <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 pt-3.5">
              <span aria-hidden className="grid size-6 place-items-center rounded-sm bg-secondary text-[13px] leading-none font-semibold tabular-nums">1</span>
              <p className="text-[15px] leading-normal">{t.rich("howStep1", { bdi })}</p>
            </li>
            <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 pt-3.5">
              <span aria-hidden className="grid size-6 place-items-center rounded-sm bg-secondary text-[13px] leading-none font-semibold tabular-nums">2</span>
              <p className="text-[15px] leading-normal">{t("howStep2")}</p>
              <CopyField label={t("address")} value={address} copyLabel={t("copyAddress")} />
            </li>
            {appIds.length > 0 ? (
              <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 pt-3.5">
                <span aria-hidden className="grid size-6 place-items-center rounded-sm bg-secondary text-[13px] leading-none font-semibold tabular-nums">3</span>
                <p className="text-[15px] leading-normal">
                  {t.rich("howStep3", { term: (chunks) => <bdi dir="ltr" className="font-medium">{chunks}</bdi> })}
                </p>
                {appIds.map((app) => (
                  <CopyField
                    key={app.clientId}
                    label={appIds.length > 1 ? <>{t("appId")} · <bdi>{app.name || t("unnamedApp")}</bdi></> : t("appId")}
                    value={app.clientId}
                    copyLabel={appIds.length > 1 ? t("copyAppIdNamed", { name: app.name || t("unnamedApp") }) : t("copyAppId")}
                  />
                ))}
              </li>
            ) : null}
          </ol>
        </div>
      </details>

      <ConfirmSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={t.rich("removeConfirmTitle", { name: removing ? labelOf(removing) : "", bdi })}
        confirmLabel={t("remove")}
        cancelLabel={t("cancel")}
        onConfirm={confirmRemove}
        tone="danger"
      >
        <p>{t.rich("removeConfirmBody", { name: removing ? labelOf(removing) : "", bdi })}</p>
        <p className="text-muted-foreground">{t("takesEffect")}</p>
      </ConfirmSheet>
    </section>
  );
}
