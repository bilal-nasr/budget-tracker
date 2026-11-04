"use client";

import { ArrowLeftRight, ArrowRight, HandCoins } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAppData } from "@/components/providers/app-data";
import { Amount } from "@/components/money/amount";
import { CategoryGlyph } from "@/components/tiles/tile-glyph";
import { categoryName } from "@/features/categories/schema";
import { signedMinor, type Transaction } from "@/features/transactions/schema";
import { cn } from "@/lib/utils";

/**
 * One activity row: glyph, title (note or category), wallet line, signed amount.
 * A move between wallets shows where the money went; an exchange also shows
 * what arrived, in the other currency.
 */
export function TransactionRow({
  transaction,
  onOpen,
}: {
  transaction: Transaction;
  onOpen: (transaction: Transaction) => void;
}) {
  const t = useTranslations("Detail");
  const ts = useTranslations("Cashier");
  const tl = useTranslations("Loans");
  const locale = useLocale();
  const { categoryById, walletById } = useAppData();
  const wallet = walletById(transaction.walletId);
  const toWallet = transaction.toWalletId ? walletById(transaction.toWalletId) : undefined;
  const category = transaction.categoryId ? categoryById(transaction.categoryId) : undefined;
  const transfer = transaction.kind === "transfer";
  const exchange = transfer && toWallet !== undefined && wallet !== undefined && toWallet.currency !== wallet.currency;
  const loan = transaction.kind === "loan";
  const name = loan ? tl(transaction.loanEvent === "disbursement" ? "disbursement" : "repayment") : transfer ? t("move") : category ? categoryName(category, locale) : "";
  const title = transaction.note || name;
  const income = transaction.kind === "income" || (loan && transaction.loanFlow === "in");

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(transaction)}
        className="flex min-h-[60px] w-full items-center gap-3 px-3.5 py-2 text-start hover:bg-accent/50 active:bg-accent"
      >
        {loan ? <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-secondary text-primary"><HandCoins className="size-5" /></span> : transfer ? (
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-secondary text-primary">
            <ArrowLeftRight className="size-5" />
          </span>
        ) : category ? (
          <CategoryGlyph tile={category.tile} color={category.color} />
        ) : (
          <span className="size-10" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            <bdi>{title}</bdi>
          </span>
          <span className="flex items-center gap-1 truncate text-[13px] text-muted-foreground">
            {transfer ? (
              <>
                <bdi className="truncate">{wallet?.name}</bdi>
                <ArrowRight aria-hidden className="size-3.5 shrink-0 rtl:-scale-x-100" />
                <bdi className="truncate">{toWallet?.name}</bdi>
              </>
            ) : (
              <>
                <bdi>{name}</bdi> · <bdi>{wallet?.name}</bdi>
              </>
            )}
          </span>
          {transaction.settlement?.change ? <span className="block truncate text-[13px] text-muted-foreground">
            {ts("changeTo")} · <bdi>{walletById(transaction.settlement.change.walletId)?.name ?? transaction.settlement.change.currency}</bdi>
          </span> : null}
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <Amount
            // A same-currency move is neutral (not spending); an exchange shows what left as negative.
            minor={transfer && !exchange ? transaction.amountMinor : signedMinor(transaction)}
            currency={transaction.currency}
            sign={!transfer}
            className={cn("font-semibold", income && "text-positive")}
          />
          {exchange && toWallet && transaction.toAmountMinor !== null ? (
            <Amount
              minor={transaction.toAmountMinor}
              currency={toWallet.currency}
              sign
              className="text-[13px] text-muted-foreground"
            />
          ) : null}
        </span>
      </button>
    </li>
  );
}
