"use client";

import { useState, useTransition } from "react";
import { Check, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { useComposer } from "@/components/shell/composer";
import { CategoryGlyph } from "@/components/tiles/tile-glyph";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { payFixedExpense } from "@/features/fixed/actions";
import type { FixedExpense } from "@/features/fixed/schema";
import { deleteTransaction } from "@/features/transactions/actions";
import type { Currency } from "@/lib/money";

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
export function FixedCard({ items }: { items: FixedExpense[] }) {
  const t = useTranslations("Fixed");
  const locale = useLocale();
  const router = useRouter();
  const { walletById, categoryById } = useAppData();
  const { openFixed } = useComposer();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const pay = (item: FixedExpense) => {
    setBusyId(item.id);
    startTransition(async () => {
      const result = await payFixedExpense(item.id);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error === "notConfigured" ? t("errorPreview") : t("errorPay"));
        return;
      }
      const id = result.id;
      router.refresh();
      toast(t("recorded", { name: item.name }), {
        action: {
          label: t("undo"),
          onClick: async () => {
            await deleteTransaction(id);
            router.refresh();
          },
        },
      });
    });
  };

  // What is still to pay this month, per currency. Currencies are never combined.
  const left: Record<Currency, number> = { USD: 0, LBP: 0 };
  for (const item of items) {
    const wallet = walletById(item.walletId);
    if (wallet && item.paidOn === null) left[wallet.currency] += item.amountMinor;
  }
  const leftCurrencies = (["USD", "LBP"] as Currency[]).filter((c) => left[c] > 0);

  return (
    <section aria-labelledby="h-fixed" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="h-fixed" className="text-[17px] font-semibold">{t("title")}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {items.length === 0 ? (
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
    </section>
  );
}
