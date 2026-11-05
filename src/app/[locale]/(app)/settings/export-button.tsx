"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

function downloadFilename(response: Response): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1]?.trim() || "budget-export.xlsx";
}

export function ExportButton() {
  const t = useTranslations("Settings");
  const locale = useLocale();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  const download = async () => {
    setStatus("loading");
    let objectUrl: string | null = null;
    try {
      const response = await fetch(`/${locale}/settings/export`, { method: "GET" });
      if (!response.ok) throw new Error("export_failed");
      objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = downloadFilename(response);
      anchor.click();
      setStatus("idle");
    } catch {
      setStatus("error");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  };

  return (
    <section aria-labelledby="s-export" className="rounded-xl border border-border bg-card p-4">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-action/10 text-action" aria-hidden="true">
          <FileSpreadsheet className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="s-export" className="text-[17px] font-semibold">{t("exportTitle")}</h2>
          <p id="s-export-help" className="mt-1 text-[13px] leading-5 text-muted-foreground">{t("exportDescription")}</p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={status === "loading"}
        aria-describedby="s-export-help"
        onClick={() => void download()}
      >
        <FileSpreadsheet aria-hidden="true" />
        {status === "loading" ? t("exportPreparing") : t("exportButton")}
      </Button>
      {status === "loading" ? <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">{t("exportPreparing")}</p> : null}
      {status === "error" ? <p role="alert" className="mt-3 text-sm text-over">{t("exportFailed")}</p> : null}
    </section>
  );
}
