"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAppData } from "@/components/providers/app-data";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { categoryName } from "@/features/categories/catalogue";
import { todayIn } from "@/features/transactions/group";
import type { Filters } from "@/features/transactions/schema";
import { cn } from "@/lib/utils";

export function FilterSheet({
  open,
  onClose,
  filters,
  wallets,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  filters: Filters;
  wallets: { id: string; name: string; currency: string }[];
  onApply: (patch: Partial<Filters>) => void;
}) {
  const t = useTranslations("Activity");
  const tc = useTranslations("Categories");
  const locale = useLocale();
  const { categories, timezone } = useAppData();
  const [balanceId, setBalanceId] = useState(filters.balanceId);
  const [categoryId, setCategoryId] = useState(filters.categoryId);
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");
  const today = todayIn(timezone);
  const chip =
    "min-h-11 rounded-full border border-border bg-card px-4 text-sm font-medium aria-checked:border-2 aria-checked:border-foreground aria-checked:bg-accent";

  // Re-sync from the URL each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setBalanceId(filters.balanceId);
      setCategoryId(filters.categoryId);
      setFrom(filters.from ?? "");
      setTo(filters.to ?? "");
    }
  }

  const bad = from !== "" && to !== "" && from > to;

  return (
    <SheetShell
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("filters")}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() => onApply({ balanceId: undefined, categoryId: undefined, from: undefined, to: undefined })}
          >
            {t("reset")}
          </Button>
          <Button
            disabled={bad}
            onClick={() => onApply({ balanceId, categoryId, from: from || undefined, to: to || undefined })}
          >
            {t("apply")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t("wallet")}</legend>
          <div role="radiogroup" aria-label={t("wallet")} className="flex flex-wrap gap-2">
            <button type="button" role="radio" aria-checked={!balanceId} onClick={() => setBalanceId(undefined)} className={chip}>
              {t("allWallets")}
            </button>
            {wallets.map((w) => (
              <button key={w.id} type="button" role="radio" aria-checked={balanceId === w.id} onClick={() => setBalanceId(w.id)} className={chip}>
                <bdi>{w.name}</bdi> · {w.currency}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t("category")}</legend>
          <div role="radiogroup" aria-label={t("category")} className="flex flex-wrap gap-2">
            <button type="button" role="radio" aria-checked={!categoryId} onClick={() => setCategoryId(undefined)} className={chip}>
              {t("allCategories")}
            </button>
            {categories.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={categoryId === c.id} onClick={() => setCategoryId(c.id)} className={chip}>
                <bdi>{categoryName(c, locale)}</bdi>{c.archivedAt !== null ? <span className="ms-1 text-muted-foreground">({tc("archived")})</span> : null}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid grid-cols-2 gap-3">
          <legend className="mb-2 text-sm font-medium">{t("dates")}</legend>
          {[
            { label: t("from"), value: from, set: setFrom },
            { label: t("to"), value: to, set: setTo },
          ].map((f) => (
            <label key={f.label} className="flex flex-col gap-1.5 text-sm">
              {f.label}
              <input
                type="date"
                value={f.value}
                max={today}
                min="2000-01-01"
                onChange={(e) => f.set(e.target.value)}
                className={cn("h-12 rounded-lg border border-input bg-card px-3 text-base", bad && "border-over")}
              />
            </label>
          ))}
          {bad ? <p role="alert" className="col-span-2 text-sm text-over">{t("dateOrder")}</p> : null}
        </fieldset>
      </div>
    </SheetShell>
  );
}
