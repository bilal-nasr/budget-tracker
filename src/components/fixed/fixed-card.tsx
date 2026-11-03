"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Check, Plus, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { useDisplayPrefs } from "@/components/providers/display-prefs";
import { useComposer } from "@/components/shell/composer";
import { CategoryGlyph } from "@/components/tiles/tile-glyph";
import { InstallmentsList } from "@/components/installments/installments-list";
import { Button } from "@/components/ui/button";
import { payFixedExpense } from "@/features/fixed/actions";
import type { FixedExpense } from "@/features/fixed/schema";
import type { Installment } from "@/features/installments/schema";
import { deleteTransaction } from "@/features/transactions/actions";
import { todayIn } from "@/features/transactions/group";
import { summarizeFixed } from "@/features/fixed/summary";
import { formatAmount, type Currency } from "@/lib/money";

function shortDate(date: string, locale: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-LB-u-nu-latn" : "en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Monthly fixed expenses. "Paid" records the expense and deducts it from its
 * wallet. Nothing is paid automatically; you press it after the salary lands.
 */
export function FixedCard({
  items: serverItems,
  installments,
}: {
  items: FixedExpense[];
  installments: Installment[];
}) {
  const t = useTranslations("Fixed");
  const locale = useLocale();
  const { walletById, categoryById, timezone, salary } = useAppData();
  const { openFixed } = useComposer();
  const { digits } = useDisplayPrefs();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Shows the item as paid the instant Paid is pressed; reverts by itself if the action fails.
  const [items, markPaid] = useOptimistic(serverItems, (list, id: string) =>
    list.map((i) => (i.id === id ? { ...i, paidOn: todayIn(timezone) } : i)),
  );

  const pay = (item: FixedExpense) => {
    setBusyId(item.id);
    startTransition(async () => {
      markPaid(item.id);
      const result = await payFixedExpense(item.id);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error === "notConfigured" ? t("errorPreview") : t("errorPay"));
        return;
      }
      const id = result.id;
      toast(t("recorded", { name: item.name }), {
        action: {
          label: t("undo"),
          onClick: async () => {
            await deleteTransaction(id);
          },
        },
      });
    });
  };

  // Currencies are never combined.
  const summary = summarizeFixed(items, walletById, salary, installments);
  const left = summary.left;
  const leftCurrencies = (["USD", "LBP"] as Currency[]).filter((c) => left[c] > 0);
  const currencies = (["USD", "LBP"] as Currency[]).filter((c) => summary.total[c] > 0);

  return (
    <section aria-labelledby="h-fixed" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="h-fixed" className="text-[17px] font-semibold">{t("title")}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {items.length === 0 && installments.length === 0 ? (
              t("explain")
            ) : leftCurrencies.length === 0 ? (
              t("allPaid")
            ) : (
              <>
                {t("left")}{" "}
                {leftCurrencies.map((c, i) => (
                  <span key={c}>
                    {i > 0 ? " · " : ""}
                    <Amount minor={left[c]} currency={c} className="font-semibold text-foreground" />
                  </span>
                ))}
              </>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => openFixed(null)} className="shrink-0" aria-label={t("addFixed")}>
          <Plus aria-hidden />
          {t("add")}
        </Button>
      </div>

      {items.length > 0 ? (
        <ul className="-mx-1 flex flex-col">
          {items.map((item) => {
            const wallet = walletById(item.walletId);
            const category = categoryById(item.categoryId);
            const paid = item.paidOn !== null;
            return (
              <li key={item.id} className="flex min-h-[64px] items-center gap-3 border-t border-border px-1 py-2 first:border-t-0">
                <button
                  type="button"
                  onClick={() => openFixed(item)}
                  aria-label={t("editItem", { name: item.name })}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-start"
                >
                  {category ? <CategoryGlyph tile={category.tile} color={category.color} /> : <span className="size-10" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      <bdi>{item.name}</bdi>
                    </span>
                    <span className="block truncate text-[13px] text-muted-foreground">
                      {wallet ? <Amount minor={item.amountMinor} currency={wallet.currency} /> : null} ·{" "}
                      <bdi>{wallet?.name}</bdi>
                      {item.dueDay ? ` · ${t("due", { day: item.dueDay })}` : ""}
                    </span>
                  </span>
                </button>
                {paid && item.paidOn ? (
                  <span className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-positive">
                    <Check aria-hidden className="size-4" />
                    {t("paidOn", { date: shortDate(item.paidOn, locale) })}
                  </span>
                ) : (
                  <Button
                    className="shrink-0"
                    disabled={pending}
                    aria-label={t("markPaid", { name: item.name })}
                    onClick={() => pay(item)}
                  >
                    {busyId === item.id ? t("paying") : t("paid")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      <InstallmentsList items={installments} />

      {items.length > 0 || installments.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <dl className="flex flex-col gap-1.5 text-[15px]">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">{t("total")}</dt>
              <dd className="text-end font-semibold">
                {currencies.map((c, i) => (
                  <span key={c}>
                    {i > 0 ? " · " : ""}
                    <Amount minor={summary.total[c]} currency={c} />
                  </span>
                ))}
              </dd>
            </div>
            {summary.salaryAfter ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">
                  {summary.salaryAfter.minor < 0 ? t("salaryShort") : t("salaryAfter")}
                </dt>
                <dd
                  className={
                    summary.salaryAfter.minor < 0
                      ? "flex items-center gap-1 text-end font-semibold text-over"
                      : "text-end font-semibold"
                  }
                >
                  {summary.salaryAfter.minor < 0 ? <TriangleAlert aria-hidden className="size-4" /> : null}
                  <Amount
                    minor={Math.abs(summary.salaryAfter.minor)}
                    currency={summary.salaryAfter.currency}
                  />
                </dd>
              </div>
            ) : null}
          </dl>
          {summary.salaryAfter?.excludesOther ? (
            <p className="text-[13px] text-muted-foreground">
              {t("excludesOther", { currency: summary.salaryAfter.currency === "USD" ? "LBP" : "USD" })}
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <h3 id="h-fixed-wallets" className="text-sm font-medium">{t("perWallet")}</h3>
            <ul aria-labelledby="h-fixed-wallets" className="flex flex-col gap-1">
              {summary.byWallet.map((need) => {
                const w = walletById(need.walletId);
                return (
                  <li key={need.walletId} className="flex items-baseline justify-between gap-3 text-[15px]">
                    <span className="min-w-0 truncate"><bdi>{w?.name}</bdi></span>
                    <span className="flex shrink-0 flex-wrap items-baseline justify-end gap-x-2 text-end">
                      {need.shortMinor > 0 ? (
                        <span className="flex items-center gap-1 text-[13px] text-over">
                          <TriangleAlert aria-hidden className="size-3.5" />
                          {t("short", { amount: formatAmount(need.shortMinor, need.currency, { digits }) })}
                        </span>
                      ) : null}
                      <Amount minor={need.totalMinor} currency={need.currency} className="font-semibold" />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
