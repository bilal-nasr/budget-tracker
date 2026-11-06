"use client";

import { ArrowLeftRight, ArrowRight, Check, HandCoins } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAppData } from "@/components/providers/app-data";
import { Amount } from "@/components/money/amount";
import { CategoryGlyph } from "@/components/tiles/tile-glyph";
import { categoryName } from "@/features/categories/catalogue";
import { signedMinor } from "@/features/transactions/amounts";
import { classifyBalanceTransfer, type Transaction } from "@/features/transactions/schema";
import { cn } from "@/lib/utils";

/**
 * One activity row: glyph, title (note or category), wallet line, signed amount.
 * A move between wallets shows where the money went; an exchange also shows
 * what arrived, in the other currency.
 */
export function TransactionRow({
  transaction,
  onOpen,
  selection,
}: {
  transaction: Transaction;
  onOpen: (transaction: Transaction) => void;
  /** In select mode the row toggles instead of opening, and shows a check. */
  selection?: { selected: boolean; onToggle: (transaction: Transaction) => void };
}) {
  const t = useTranslations("Detail");
  const ts = useTranslations("Cashier");
  const tl = useTranslations("Loans");
  const locale = useLocale();
  const { categoryById, balanceById, walletById } = useAppData();
  const sourceBalance = balanceById(transaction.balanceId);
  const wallet = sourceBalance ? { ...sourceBalance, name: walletById(sourceBalance.walletId)?.name ?? transaction.walletNameSnapshot } : undefined;
  const destinationBalance = transaction.toBalanceId ? balanceById(transaction.toBalanceId) : undefined;
  const toWallet = destinationBalance ? { ...destinationBalance, name: walletById(destinationBalance.walletId)?.name ?? transaction.toWalletNameSnapshot } : undefined;
  const category = transaction.categoryId ? categoryById(transaction.categoryId) : undefined;
  const transfer = transaction.kind === "transfer";
  const crossCurrency = transfer && toWallet !== undefined && toWallet.currency !== transaction.currency;
  const exchange = transfer && sourceBalance && destinationBalance ? sourceBalance.id !== destinationBalance.id && classifyBalanceTransfer(sourceBalance, destinationBalance) === "exchange" : false;
  const loan = transaction.kind === "loan";
  const name = loan ? tl(transaction.loanEvent === "disbursement" ? "disbursement" : "repayment") : transfer ? t(exchange ? "exchange" : "move") : category ? categoryName(category, locale) : "";
  const title = transaction.note || name;
  const income = transaction.kind === "income" || (loan && transaction.loanFlow === "in");

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        role={selection ? "checkbox" : undefined}
        aria-checked={selection ? selection.selected : undefined}
        onClick={() => (selection ? selection.onToggle(transaction) : onOpen(transaction))}
        className={cn(
          "flex min-h-[60px] w-full items-center gap-3 px-3.5 py-2 text-start hover:bg-accent/50 active:bg-accent",
          selection?.selected && "bg-accent/60",
        )}
      >
        {selection ? (
          <span
            aria-hidden
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors",
              selection.selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
            )}
          >
            {selection.selected ? <Check className="size-4" strokeWidth={3} /> : null}
          </span>
        ) : null}
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
          {transaction.settlement && transaction.settlement.changes.length > 0 ? <span className="block truncate text-[13px] text-muted-foreground">
            {ts("changeTo")} · {transaction.settlement.changes.map((change, index) => <span key={`${change.balanceId}-${index}`}>
              {index > 0 ? " / " : null}<bdi>{(() => { const balance = balanceById(change.balanceId); return (balance ? walletById(balance.walletId)?.name : undefined) ?? change.currency; })()}</bdi>
            </span>)}
          </span> : null}
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <Amount
            // A same-currency move is neutral (not spending); an exchange shows what left as negative.
            minor={transfer && !crossCurrency ? transaction.amountMinor : signedMinor(transaction)}
            currency={transaction.currency}
            sign={!transfer}
            className={cn("font-semibold", income && "text-positive")}
          />
          {crossCurrency && toWallet && transaction.toAmountMinor !== null ? (
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
