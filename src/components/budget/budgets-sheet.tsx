"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { CategoryGlyph } from "@/components/tiles/tile-glyph";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { saveBudgets } from "@/features/budgets/actions";
import type { MonthBudgets } from "@/features/budgets/schema";
import { categoryName } from "@/features/categories/schema";
import { parseAmount, toInputText } from "@/lib/money";

export type BudgetsSheetState = { data: MonthBudgets; salaryAfterMinor: number | null };

function Form({ state, onClose }: { state: BudgetsSheetState; onClose: () => void }) {
  const t = useTranslations("Budgets");
  const locale = useLocale();
  const { categories } = useAppData();
  const [pending, startTransition] = useTransition();
  const { data, salaryAfterMinor } = state;
  const { currency } = data;

  const list = categories.filter((c) => c.kind === "expense");
  const initial = new Map(data.rows.map((r) => [r.categoryId, r.limitMinor]));
  const startText = (id: string) => {
    const v = initial.get(id);
    return v ? toInputText(v, currency) : "";
  };
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(list.map((c) => [c.id, startText(c.id)])),
  );
  const [error, setError] = useState<string | null>(null);

  const parse = (text: string) => (text.trim() === "" ? null : parseAmount(text, currency));
  const invalid = list.some((c) => texts[c.id]?.trim() !== "" && parse(texts[c.id]) === null);
  const total = list.reduce((sum, c) => sum + (parse(texts[c.id] ?? "") ?? 0), 0);
  const changed = list.filter((c) => (parse(texts[c.id] ?? "") ?? null) !== (initial.get(c.id) ?? null));
  const unbudgeted = salaryAfterMinor === null ? null : salaryAfterMinor - total;

  const [y, m] = data.month.split("-").map(Number);
  const monthLabel = new Intl.DateTimeFormat(locale === "ar" ? "ar-LB-u-nu-latn" : "en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveBudgets({
        month: data.month,
        currency,
        limits: changed.map((c) => ({ categoryId: c.id, limitMinor: parse(texts[c.id] ?? "") })),
      });
      if (!result.ok) {
        setError(result.error === "notConfigured" ? t("errorPreview") : t("errorFailed"));
        return;
      }
      onClose();
      toast(t("saved"));
    });
  };

  return (
    <form
      className="flex flex-col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) save();
      }}
    >
      <p className="pb-2 text-[14px] text-muted-foreground">{t("sheetCopy", { month: monthLabel })}</p>
      <ul>
        {list.map((c) => {
          const name = categoryName(c, locale);
          const bad = texts[c.id]?.trim() !== "" && parse(texts[c.id] ?? "") === null;
          return (
            <li key={c.id} className="flex min-h-[60px] items-center gap-3 border-t border-border">
              <CategoryGlyph tile={c.tile} color={c.color} />
              <span className="min-w-0 flex-1 truncate font-medium">
                <bdi>{name}</bdi>
              </span>
              <input
                aria-label={t("amountFor", { name })}
                aria-invalid={bad ? true : undefined}
                value={texts[c.id] ?? ""}
                onChange={(e) => setTexts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                inputMode={currency === "USD" ? "decimal" : "numeric"}
                placeholder={t("none")}
                autoComplete="off"
                dir="ltr"
                className="h-12 w-32 shrink-0 rounded-lg border border-input bg-card px-3 text-end text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-over"
              />
            </li>
          );
        })}
      </ul>

      <div className="sticky -mx-4 bottom-0 mt-2 flex flex-col gap-2 border-t border-border bg-card px-4 pt-3 pb-[calc(0.75rem+var(--safe-bottom))]">
        <div className="flex items-baseline justify-between text-[15px]">
          <span>{t("totalBudgets")}</span>
          <Amount minor={total} currency={currency} className="font-bold" />
        </div>
        {salaryAfterMinor !== null ? (
          <>
            <div className="flex items-baseline justify-between text-[14px] text-muted-foreground">
              <span>{t("salaryAfter")}</span>
              <Amount minor={salaryAfterMinor} currency={currency} />
            </div>
            <div className="flex items-baseline justify-between text-[14px] text-muted-foreground">
              <span>{unbudgeted !== null && unbudgeted < 0 ? t("unbudgetedOver") : t("unbudgeted")}</span>
              <Amount minor={Math.abs(unbudgeted ?? 0)} currency={currency} />
            </div>
          </>
        ) : null}
        {invalid ? <p role="alert" className="text-sm text-over">{t("errorAmount")}</p> : null}
        {error ? (
          <p role="alert" className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">{error}</p>
        ) : null}
        <Button type="submit" variant="action" size="lg" className="w-full" disabled={invalid || pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}

export function BudgetsSheet({ state, onClose }: { state: BudgetsSheetState | null; onClose: () => void }) {
  const t = useTranslations("Budgets");
  return (
    <SheetShell open={state !== null} onOpenChange={(open) => !open && onClose()} title={t("sheetTitle")}>
      {state ? <Form key={`${state.data.month}-${state.data.currency}`} state={state} onClose={onClose} /> : null}
    </SheetShell>
  );
}
