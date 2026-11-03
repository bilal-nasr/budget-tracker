"use client";

import { useLocale } from "next-intl";
import { useAppData } from "@/components/providers/app-data";
import { Amount } from "@/components/money/amount";
import { CategoryGlyph } from "@/components/tiles/tile-glyph";
import { categoryName } from "@/features/categories/schema";
import { signedMinor, type Transaction } from "@/features/transactions/schema";
import { cn } from "@/lib/utils";

/** One activity row: glyph, title (note or category), wallet line, signed amount. */
export function TransactionRow({
  transaction,
  onOpen,
}: {
  transaction: Transaction;
  onOpen: (transaction: Transaction) => void;
}) {
  const locale = useLocale();
  const { categoryById, walletById } = useAppData();
  const category = categoryById(transaction.categoryId);
  const wallet = walletById(transaction.walletId);
  const name = category ? categoryName(category, locale) : "";
  const title = transaction.note || name;
  const income = transaction.kind === "income";

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(transaction)}
        className="flex min-h-[60px] w-full items-center gap-3 px-3.5 py-2 text-start hover:bg-accent/50 active:bg-accent"
      >
        {category ? <CategoryGlyph tile={category.tile} color={category.color} /> : <span className="size-10" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            <bdi>{title}</bdi>
          </span>
          <span className="block truncate text-[13px] text-muted-foreground">
            <bdi>{name}</bdi> · <bdi>{wallet?.name}</bdi>
          </span>
        </span>
        <Amount
          minor={signedMinor(transaction)}
          currency={transaction.currency}
          sign
          className={cn("font-semibold", income && "text-positive")}
        />
      </button>
    </li>
  );
}
