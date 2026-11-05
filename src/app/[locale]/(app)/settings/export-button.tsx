"use client";

import { useState } from "react";
import { Check, FileSpreadsheet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import {
  DEFAULT_SIMPLE,
  SECTION_GROUPS,
  SIMPLE_PERIODS,
  exportQuery,
  type ExportOptions,
  type SectionGroup,
  type SimplePeriod,
} from "@/features/export/options";

function downloadFilename(response: Response): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1]?.trim() || "budget-export.xlsx";
}

function CheckRow({ checked, onChange, title, hint }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  hint: string;
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-start gap-3 py-2.5">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
      <span
        aria-hidden="true"
        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-[6px] border border-input bg-card text-primary-foreground transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100"
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium leading-snug">{title}</span>
        <span className="block text-[13px] leading-5 text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

export function ExportButton() {
  const t = useTranslations("Settings");
  const locale = useLocale();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [mode, setMode] = useState<ExportOptions["mode"]>("detailed");
  const [sections, setSections] = useState<readonly SectionGroup[]>(SECTION_GROUPS);
  const [period, setPeriod] = useState<SimplePeriod>(DEFAULT_SIMPLE.period);
  const [balances, setBalances] = useState(DEFAULT_SIMPLE.balances);
  const [notes, setNotes] = useState(DEFAULT_SIMPLE.notes);

  const allSelected = sections.length === SECTION_GROUPS.length;
  const nothingSelected = mode === "detailed" && sections.length === 0;

  const toggleSection = (group: SectionGroup, on: boolean) =>
    setSections(SECTION_GROUPS.filter((item) => (item === group ? on : sections.includes(item))));

  const download = async () => {
    setStatus("loading");
    let objectUrl: string | null = null;
    const options: ExportOptions = mode === "detailed"
      ? { mode, sections }
      : { mode, period, balances, notes };
    try {
      const response = await fetch(`/${locale}/settings/export?${exportQuery(options)}`, { method: "GET", redirect: "error" });
      if (!response.ok) throw new Error("export_failed");
      const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (response.redirected || contentType !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
        throw new Error("export_failed");
      }
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

      <Segmented
        label={t("exportFormat")}
        value={mode}
        onChange={(next) => { setMode(next); setStatus("idle"); }}
        options={[
          { value: "detailed", label: t("exportFormatDetailed") },
          { value: "simple", label: t("exportFormatSimple") },
        ]}
      />
      <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
        {mode === "detailed" ? t("exportDetailedHint") : t("exportSimpleHint")}
      </p>

      {mode === "detailed" ? (
        <fieldset className="mt-3 min-w-0 border-0 p-0">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <legend className="float-start text-sm font-semibold">{t("exportInclude")}</legend>
            <button
              type="button"
              onClick={() => setSections(allSelected ? [] : SECTION_GROUPS)}
              className="min-h-11 shrink-0 rounded-lg px-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {allSelected ? t("exportClearAll") : t("exportSelectAll")}
            </button>
          </div>
          <div className="divide-y divide-border">
            {SECTION_GROUPS.map((group) => (
              <CheckRow
                key={group}
                checked={sections.includes(group)}
                onChange={(on) => toggleSection(group, on)}
                title={t(`exportGroup_${group}`)}
                hint={t(`exportGroup_${group}_hint`)}
              />
            ))}
          </div>
        </fieldset>
      ) : (
        <div className="mt-3">
          <p className="mb-1.5 text-sm font-semibold">{t("exportPeriod")}</p>
          <Segmented
            label={t("exportPeriod")}
            value={period}
            onChange={setPeriod}
            options={SIMPLE_PERIODS.map((value) => ({ value, label: t(`exportPeriod_${value}`) }))}
          />
          <div className="mt-2 divide-y divide-border">
            <CheckRow checked={balances} onChange={setBalances} title={t("exportSimpleBalances")} hint={t("exportSimpleBalancesHint")} />
            <CheckRow checked={notes} onChange={setNotes} title={t("exportSimpleNotes")} hint={t("exportSimpleNotesHint")} />
          </div>
        </div>
      )}

      <Button
        type="button"
        className="mt-4 w-full"
        disabled={status === "loading" || nothingSelected}
        aria-describedby="s-export-help"
        onClick={() => void download()}
      >
        <FileSpreadsheet aria-hidden="true" />
        {status === "loading" ? t("exportPreparing") : t("exportButton")}
      </Button>
      {nothingSelected ? <p className="mt-3 text-sm text-muted-foreground">{t("exportNothingSelected")}</p> : null}
      {status === "loading" ? <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">{t("exportPreparing")}</p> : null}
      {status === "error" ? <p role="alert" className="mt-3 text-sm text-over">{t("exportFailed")}</p> : null}
    </section>
  );
}
