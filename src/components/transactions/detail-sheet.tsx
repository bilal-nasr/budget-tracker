"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { CategoryGlyph } from "@/components/tiles/tile-glyph";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { useRouter } from "@/i18n/navigation";
import { categoryName } from "@/features/categories/schema";
import { deleteTransaction, restoreTransaction } from "@/features/transactions/actions";
import { signedMinor, type Transaction } from "@/features/transactions/schema";

function dateLabel(date: string, locale: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-LB-u-nu-latn" : "en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function DetailSheet({
  transaction,
  onClose,
  onEdit,
  onDuplicate,
}: {
  transaction: Transaction | null;
  onClose: () => void;
  onEdit: (transaction: Transaction) => void;
  onDuplicate: (transaction: Transaction) => void;
}) {
  const t = useTranslations("Detail");
  const locale = useLocale();
  const router = useRouter();
  const { categoryById, walletById } = useAppData();
  const [pending, startTransition] = useTransition();
  const category = transaction ? categoryById(transaction.categoryId) : undefined;
  const wallet = transaction ? walletById(transaction.walletId) : undefined;

  const remove = () => {
    if (!transaction) return;
    const id = transaction.id;
    startTransition(async () => {
      const result = await deleteTransaction(id);
      if (!result.ok) {
        toast.error(result.error === "notConfigured" ? t("errorPreview") : t("errorFailed"));
        return;
      }
      onClose();
      router.refresh();
      toast(t("deleted"), {
        action: {
          label: t("undo"),
          onClick: async () => {
            await restoreTransaction(id);
            router.refresh();
          },
        },
      });
    });
  };

  return (
    <SheetShell
      open={transaction !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("title")}
    >
      {transaction ? (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            {category ? <CategoryGlyph tile={category.tile} color={category.color} /> : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[17px] font-semibold">
                <bdi>{category ? categoryName(category, locale) : ""}</bdi>
              </p>
              <p className="text-[13px] text-muted-foreground">
                {transaction.kind === "income" ? t("income") : t("expense")}
              </p>
            </div>
          </div>
          <Amount
            minor={signedMinor(transaction)}
            currency={transaction.currency}
            sign
            className="text-[40px] leading-none font-bold tracking-tight"
          />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[15px]">
            <dt className="text-muted-foreground">{t("wallet")}</dt>
            <dd className="text-end font-medium">
              <bdi>{wallet?.name}</bdi> · {wallet?.currency}
            </dd>
            <dt className="text-muted-foreground">{t("date")}</dt>
            <dd className="text-end font-medium">{dateLabel(transaction.occurredOn, locale)}</dd>
            {transaction.note ? (
              <>
                <dt className="text-muted-foreground">{t("note")}</dt>
                <dd className="text-end font-medium">
                  <bdi>{transaction.note}</bdi>
                </dd>
              </>
            ) : null}
          </dl>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => onEdit(transaction)}>
              {t("edit")}
            </Button>
            <Button variant="outline" onClick={() => onDuplicate(transaction)}>
              {t("duplicate")}
            </Button>
            <Button variant="destructive" className="col-span-2" disabled={pending} onClick={remove}>
              {t("delete")}
            </Button>
          </div>
        </div>
      ) : null}
    </SheetShell>
  );
}
