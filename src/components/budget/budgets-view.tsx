"use client";

import { Plus, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { TileBar } from "@/components/budget/tile-bar";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { useDisplayPrefs } from "@/components/providers/display-prefs";
import { useComposer } from "@/components/shell/composer";
import { EmptyState } from "@/components/shell/empty-state";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";
import { CategoryGlyph } from "@/components/tiles/tile-glyph";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { isOver } from "@/features/budgets/rows";
import type { BudgetRow, MonthBudgets } from "@/features/budgets/schema";
import { categoryName } from "@/features/categories/catalogue";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { formatAmount, type Currency } from "@/lib/money";

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

function Row({ row, data }: { row: BudgetRow; data: MonthBudgets }) {
  const t = useTranslations("Budgets");
  const locale = useLocale();
  const { categoryById } = useAppData();
  const { openAdd } = useComposer();
  const { digits } = useDisplayPrefs();
  const category = categoryById(row.categoryId);
  if (!category) return null;
  const name = categoryName(category, locale);
  const money = (v: number) => `⁦${formatAmount(v, data.currency, { digits })}⁩`;
  const over = isOver(row);
  const range = monthRange(data.month);

  return (
    <li className="flex flex-col gap-2 border-t border-border px-3.5 py-3 first:border-t-0">
      <div className="flex min-h-11 items-center gap-3">
        <Link
          href={{ pathname: "/activity", query: { categoryId: row.categoryId, ...range } }}
          aria-label={t("seeActivity", { name })}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-start"
        >
          <CategoryGlyph tile={category.tile} color={category.color} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              <bdi>{name}</bdi>{category.archivedAt !== null ? <span className="ms-2 text-[13px] font-normal text-muted-foreground">{t("archived")}</span> : null}
            </span>
            <span className="block text-[13px] text-muted-foreground">
              {row.limitMinor === null
                ? t("spentOnly", { amount: money(row.spentMinor) })
                : t("of", { spent: money(row.spentMinor), limit: money(row.limitMinor) })}
            </span>
          </span>
        </Link>
        {row.leftMinor !== null ? (
          over ? (
            <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-over">
              <TriangleAlert aria-hidden className="size-4" />
              {t("overBy", { amount: money(-row.leftMinor) })}
            </span>
          ) : (
            <span className="shrink-0 text-[13px] text-muted-foreground">{t("left", { amount: money(row.leftMinor) })}</span>
          )
        ) : null}
        {category.archivedAt === null ? <Button
          variant="ghost"
          size="icon"
          aria-label={t("addTo", { name })}
          onClick={() => openAdd({ kind: "expense", categoryId: row.categoryId })}
        >
          <Plus aria-hidden />
        </Button> : null}
      </div>
      {row.limitMinor !== null ? (
        <TileBar
          value={row.progress}
          label={t("meterLabel", { name, spent: money(row.spentMinor), limit: money(row.limitMinor) })}
        />
      ) : null}
    </li>
  );
}

export function BudgetsView({
  data,
  currencies,
  salaryAfterMinor,
}: {
  data: MonthBudgets;
  currencies: Currency[];
  salaryAfterMinor: number | null;
}) {
  const t = useTranslations("Budgets");
  const nav = useTranslations("Nav");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { openBudgets } = useComposer();

  const budgeted = data.rows.filter((r) => r.limitMinor !== null);
  const unbudgeted = data.rows.filter((r) => r.limitMinor === null);
  const overCount = budgeted.filter(isOver).length;
  const left = data.totalLimitMinor - data.totalSpentMinor;
  const hasBudgets = budgeted.length > 0;
  const edit = () => openBudgets({ data, salaryAfterMinor });

  return (
    <>
      <ScreenHeader title={nav("budgets")} month>
        <p className="text-[15px] text-shell-muted">{t("spent")}</p>
        <p className={`mt-0.5 leading-tight font-bold tracking-tight ${formatAmount(data.totalSpentMinor, data.currency).length > 16 ? "text-xl" : "text-[34px]"}`}>
          <Amount minor={data.totalSpentMinor} currency={data.currency} />
        </p>
        <p className="mt-0.5 text-[15px] text-shell-muted">
          {hasBudgets ? (
            left >= 0 ? (
              t("spentOf", {
                limit: `⁦${formatAmount(data.totalLimitMinor, data.currency)}⁩`,
                left: `⁦${formatAmount(left, data.currency)}⁩`,
              })
            ) : (
              t("overBy", { amount: `⁦${formatAmount(-left, data.currency)}⁩` })
            )
          ) : (
            t("noBudgetsMonth")
          )}
        </p>
      </ScreenHeader>
      <PageBody className="gap-4">
        {currencies.length > 1 ? (
          <Segmented
            label={t("currency")}
            value={data.currency}
            onChange={(next) => {
              const query = Object.fromEntries(params);
              router.replace({ pathname, query: { ...query, currency: next } });
            }}
            options={currencies.map((c) => ({ value: c, label: c }))}
          />
        ) : null}

        {!hasBudgets && unbudgeted.length === 0 ? (
          <EmptyState
            title={t("emptyTitle")}
            body={t("emptyBody")}
            action={<Button onClick={edit}>{t("set")}</Button>}
          />
        ) : (
          <>
            {overCount > 0 ? (
              <p role="status" className="flex items-center gap-2.5 rounded-xl bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">
                <TriangleAlert aria-hidden className="size-4 shrink-0" />
                {t("overCount", { count: overCount })}
              </p>
            ) : null}
            {hasBudgets ? (
              <ul aria-label={nav("budgets")} className="overflow-hidden rounded-xl border border-border bg-card">
                {budgeted.map((row) => (
                  <Row key={row.categoryId} row={row} data={data} />
                ))}
              </ul>
            ) : null}
            {unbudgeted.length > 0 ? (
              <section aria-labelledby="h-unbudgeted" className="flex flex-col gap-2">
                <h2 id="h-unbudgeted" className="text-[17px] font-semibold">{t("notBudgeted")}</h2>
                <ul className="overflow-hidden rounded-xl border border-border bg-card">
                  {unbudgeted.map((row) => (
                    <Row key={row.categoryId} row={row} data={data} />
                  ))}
                </ul>
              </section>
            ) : null}
            <Button variant="outline" size="lg" onClick={edit}>
              {t("edit")}
            </Button>
          </>
        )}
      </PageBody>
    </>
  );
}
