"use client";
import { useRouter } from "@/i18n/navigation";
import { currencyIntent } from "@/lib/currency-intent";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Amount } from "@/components/money/amount";
import { useRuntimeBalances, useMoneyDraftUnit } from "@/components/add/runtime-balances";
import { CategoryGlyph } from "@/components/tiles/tile-glyph";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { saveBudgets } from "@/features/budgets/actions";
import type { MonthBudgets } from "@/features/budgets/schema";
import { categoryName } from "@/features/categories/catalogue";
import { MoneyRangeError, parseAmount, sumMinor, toInputText } from "@/lib/money";
import { numericInputClassName, numericInputProps } from "@/components/ui/text-field";

export type BudgetsSheetState = { data: MonthBudgets; salaryAfterMinor: number | null };

function Form({ state, onClose }: { state: BudgetsSheetState; onClose: () => void }) {
  const router = useRouter();
  const t = useTranslations("Budgets");
  const tc = useTranslations("Categories");
  const locale = useLocale();
  const { categories, definition, currencyByCode } = useRuntimeBalances();
  const [pending, startTransition] = useTransition();
  const { data, salaryAfterMinor } = state;
  const { currency } = data;
  const unit = currencyByCode(currency);
  const tCurrency = useTranslations("Currencies");

  const initial = new Map(data.rows.map((r) => [r.categoryId, r.limitMinor]));
  const list = categories.filter((c) => c.kind === "expense" && c.parentId === null && (c.archivedAt === null || initial.get(c.id) != null));
  const startText = (id: string) => {
    const v = initial.get(id);
    return v ? toInputText(v, definition(currency)) : "";
  };
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(list.map((c) => [c.id, startText(c.id)])),
  );
  const [error, setError] = useState<string | null>(null);

  useMoneyDraftUnit(unit, () => { setTexts(Object.fromEntries(list.map((category) => [category.id, ""]))); }, !!unit && !unit.disabled);
  const parse = (text: string) => (!unit || text.trim() === "" ? null : parseAmount(text, unit));
  const invalid = list.some((c) => texts[c.id]?.trim() !== "" && parse(texts[c.id]) === null);
  let total: number | null = null;
  let unbudgeted: number | null = null;
  try {
    total = sumMinor(list.map((c) => parse(texts[c.id] ?? "") ?? 0));
    if (salaryAfterMinor !== null) unbudgeted = sumMinor([salaryAfterMinor, -total]);
  } catch (rangeError) {
    if (!(rangeError instanceof MoneyRangeError)) throw rangeError;
    total = null;
  }
  const changed = list.filter((c) => (parse(texts[c.id] ?? "") ?? null) !== (initial.get(c.id) ?? null));

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
        expectedUnits: currencyIntent(unit),
        month: data.month,
        currency,
        limits: changed.map((c) => ({ categoryId: c.id, limitMinor: parse(texts[c.id] ?? "") })),
      });
      if (!result.ok) {
        if (result.error === "conflict") { setTexts(Object.fromEntries(list.map((category) => [category.id, ""]))); router.refresh(); }
        setError(result.error === "notConfigured" ? t("errorPreview") : result.error === "categoryUnavailable" ? tc("errorUnavailable") : t("errorFailed"));
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
        if (unit && !unit.disabled && !invalid && total !== null) save();
      }}
    >
      <p className="pb-2 text-[14px] text-muted-foreground">{t("sheetCopy", { month: monthLabel })}</p>
      {!unit ? <p role="status">{tCurrency("draftUnavailable")}</p> : null}
      <ul>
        {list.map((c) => {
          const name = categoryName(c, locale);
          const bad = texts[c.id]?.trim() !== "" && parse(texts[c.id] ?? "") === null;
          return (
            <li key={c.id} className="flex min-h-[60px] items-center gap-3 border-t border-border">
              <CategoryGlyph tile={c.tile} color={c.color} />
              <span className="min-w-0 flex-1 font-medium">
                <span className="block truncate"><bdi>{name}</bdi></span>
                {c.archivedAt !== null ? <span className="block text-[13px] font-normal text-muted-foreground">{t("archived")}</span> : null}
              </span>
              {c.archivedAt !== null ? <div className="flex shrink-0 flex-col items-end gap-1 py-2">
                {unit && texts[c.id] ? <Amount minor={parse(texts[c.id]) ?? 0} currency={currency} /> : <span className="text-sm text-muted-foreground">{t("none")}</span>}
                <Button type="button" variant="outline" aria-label={t(texts[c.id] ? "clearArchivedNamed" : "keepArchivedNamed", { name })} onClick={() => setTexts((prev) => ({ ...prev, [c.id]: prev[c.id] ? "" : startText(c.id) }))}>{t(texts[c.id] ? "clear" : "keep")}</Button>
              </div> : <input
                aria-label={t("amountFor", { name })}
                aria-invalid={bad ? true : undefined}
                value={texts[c.id] ?? ""}
                onChange={(e) => setTexts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                disabled={!unit}
                inputMode={unit?.decimalPlaces === 0 ? "numeric" : "decimal"}
                placeholder={t("none")}
                {...numericInputProps}
                className={`h-12 w-32 shrink-0 rounded-lg border border-input bg-card px-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-over ${numericInputClassName}`}
              />}
            </li>
          );
        })}
      </ul>

      <div className="sticky -mx-4 bottom-0 mt-2 flex flex-col gap-2 border-t border-border bg-card px-4 pt-3 pb-[calc(0.75rem+var(--safe-bottom))]">
        <div className="flex items-baseline justify-between text-[15px]">
          <span>{t("totalBudgets")}</span>
          {unit && total !== null ? <Amount minor={total} currency={currency} className="font-bold" /> : null}
        </div>
        {unit && salaryAfterMinor !== null && total !== null ? (
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
        {total === null ? <p role="alert" className="text-sm text-over">{t("totalTooLarge")}</p> : null}
        {error ? (
          <p role="alert" className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">{error}</p>
        ) : null}
        <Button type="submit" variant="action" size="lg" className="w-full" disabled={!unit || unit.disabled || invalid || total === null || pending}>
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
