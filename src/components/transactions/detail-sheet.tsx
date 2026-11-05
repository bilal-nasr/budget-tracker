"use client";

import { useState, useTransition } from "react";
import { ArrowLeftRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { CategoryGlyph } from "@/components/tiles/tile-glyph";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { categoryName } from "@/features/categories/catalogue";
import { correctTransactionNote, deleteTransaction, restoreTransaction } from "@/features/transactions/actions";
import { TextField } from "@/components/ui/text-field";
import { signedMinor } from "@/features/transactions/amounts";
import { classifyBalanceTransfer, type Transaction } from "@/features/transactions/schema";
import { ExpenseBreakdown } from "./expense-breakdown";
import { useExpenseBreakdownLabels } from "@/components/add/expense-breakdown-labels";
import { Link } from "@/i18n/navigation";
import { CashSettlementSummary } from "./cash-settlement-summary";

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
  onReload = () => window.location.reload(),
}: {
  transaction: Transaction | null;
  onClose: () => void;
  onEdit: (transaction: Transaction) => void;
  onDuplicate: (transaction: Transaction) => void;
  onReload?: () => void;
}) {
  const t = useTranslations("Detail");
  const tb = useTranslations("Breakdown");
  const ts = useTranslations("Cashier");
  const ti = useTranslations("Installments");
  const tl = useTranslations("Loans");
  const breakdownLabels = useExpenseBreakdownLabels();
  const locale = useLocale();
  const { categoryById, balanceById, walletById, currencyByCode } = useAppData();
  const [pending, startTransition] = useTransition();
  const [conflictSnapshot, setConflictSnapshot] = useState<{ id: string; revision: number } | null>(null);
  const conflicted = Boolean(transaction && conflictSnapshot
    && transaction.id === conflictSnapshot.id && transaction.revision === conflictSnapshot.revision);
  const [reloading, setReloading] = useState(false);
  const reloadLatest = () => {
    setReloading(true);
    onReload();
  };
  const transfer = transaction?.kind === "transfer";
  const loan = transaction?.kind === "loan";
  const category = transaction?.categoryId ? categoryById(transaction.categoryId) : undefined;
  const sourceBalance = transaction ? balanceById(transaction.balanceId) : undefined;
  const wallet = sourceBalance ? { ...sourceBalance, name: walletById(sourceBalance.walletId)?.name ?? transaction?.walletNameSnapshot } : undefined;
  const destinationBalance = transaction?.toBalanceId ? balanceById(transaction.toBalanceId) : undefined;
  const toWallet = destinationBalance ? { ...destinationBalance, name: walletById(destinationBalance.walletId)?.name ?? transaction?.toWalletNameSnapshot } : undefined;
  const exchange = transfer && sourceBalance && destinationBalance && sourceBalance.id !== destinationBalance.id && classifyBalanceTransfer(sourceBalance, destinationBalance) === "exchange";
  const historyIds = transaction ? [transaction.balanceId, transaction.toBalanceId, ...(transaction.settlement?.changes.map((change) => change.balanceId) ?? [])].filter((id): id is string => !!id) : [];
  const historyLocked = !!transaction && (currencyByCode(transaction.currency)?.disabled || historyIds.some((id) => {
    const balance = balanceById(id);
    const owner = balance ? walletById(balance.walletId) : undefined;
    return balance ? balance.detached || !owner || owner.deleted || owner.needsAttention || currencyByCode(balance.currency)?.disabled : true;
  }));

  const remove = () => {
    if (!transaction || historyLocked || conflicted || reloading || pending) return;
    const id = transaction.id;
    startTransition(async () => {
      const result = await deleteTransaction(id, transaction.revision);
      if (!result.ok) {
        if (result.error === "conflict") setConflictSnapshot({ id, revision: transaction.revision });
        toast.error(result.error === "notConfigured" ? t("errorPreview") : result.error === "conflict" ? tb("conflict") : t("errorFailed"));
        return;
      }
      onClose();
      toast(t("deleted"), {
        action: {
          label: t("undo"),
          onClick: async () => {
            const restored = await restoreTransaction(id, result.revision);
            if (!restored.ok) {
              if (restored.error === "conflict") toast.error(tb("conflict"), {
                action: { label: tb("reload"), onClick: onReload },
              });
              else toast.error(restored.error === "walletUnavailable" ? ts("walletUnavailable") : restored.error === "exceedsRemaining" ? ti("restoreOvercap") : t("errorFailed"));
            }
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
            {transfer ? (
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-secondary text-primary">
                <ArrowLeftRight className="size-5" />
              </span>
            ) : category ? (
              <CategoryGlyph tile={category.tile} color={category.color} />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[17px] font-semibold">
                <bdi>{loan ? tl("loan") : transfer ? t(exchange ? "exchange" : "move") : category ? categoryName(category, locale) : ""}</bdi>
              </p>
              <p className="text-[13px] text-muted-foreground">
                {loan ? tl(transaction.loanEvent === "disbursement" ? "disbursement" : "repayment") : transfer ? t(exchange ? "exchangeLine" : "moveLine") : transaction.kind === "income" ? t("income") : t("expense")}
              </p>
            </div>
          </div>

          {transfer && wallet && toWallet && transaction.toAmountMinor !== null ? (
            <div className="flex flex-col gap-1">
              <Amount
                minor={-transaction.amountMinor}
                currency={transaction.currency}
                className="text-[34px] leading-none font-bold tracking-tight"
              />
              <Amount
                minor={transaction.toAmountMinor}
                currency={toWallet.currency}
                sign
                className="text-[22px] leading-tight font-semibold text-positive"
              />
            </div>
          ) : (
            <Amount
              minor={signedMinor(transaction)}
              currency={transaction.currency}
              sign
              className="text-[40px] leading-none font-bold tracking-tight"
            />
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[15px]">
            {transfer ? (
              <>
                <dt className="text-muted-foreground">{t("from")}</dt>
                <dd className="text-end font-medium">
                  <bdi>{wallet?.name}</bdi> · {wallet?.currency}
                </dd>
                <dt className="text-muted-foreground">{t("to")}</dt>
                <dd className="text-end font-medium">
                  <bdi>{toWallet?.name}</bdi> · {toWallet?.currency}
                </dd>
              </>
            ) : (
              <>
                <dt className="text-muted-foreground">{t("wallet")}</dt>
                <dd className="text-end font-medium">
                  <bdi>{wallet?.name}</bdi> · {wallet?.currency}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">{t("date")}</dt>
            <dd className="text-end font-medium">{dateLabel(transaction.occurredOn, locale)}</dd>
            {transaction.note ? (
              <>
                <dt className="text-muted-foreground">{transfer ? t("note") : t("name")}</dt>
                <dd className="text-end font-medium">
                  <bdi>{transaction.note}</bdi>
                </dd>
              </>
            ) : null}
          </dl>

          {loan ? <div className="flex flex-col gap-2 text-sm"><p className="text-muted-foreground">{tl("movementHelp")}</p>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <dt>{tl("principalPart")}</dt><dd><Amount minor={transaction.loanPrincipalMinor ?? 0} currency={transaction.currency} /></dd>
              <dt>{tl("feePart")}</dt><dd><Amount minor={transaction.loanFeeMinor ?? 0} currency={transaction.currency} /></dd>
            </dl>
          </div> : null}
          {transaction.kind === "expense" ? <ExpenseBreakdown items={transaction.items}
            parentMinor={transaction.amountMinor} currency={transaction.currency} labels={breakdownLabels} /> : null}
          {transaction.settlement ? <CashSettlementSummary settlement={transaction.settlement} costMinor={transaction.amountMinor}
            currency={transaction.currency} changeWalletNames={transaction.settlement.changes.map((change) => {
              const balance = balanceById(change.balanceId);
              return balance ? walletById(balance.walletId)?.name : undefined;
            })} /> : null}

          {transaction.source === "salary" ? <p className="text-sm text-muted-foreground">{ti("salaryDeleteHelp")}</p> : null}
          {transaction.installmentId ? <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p>{ti("noDuplicateHelp")}</p>
            <Link href="/" onClick={onClose} className="inline-flex min-h-11 items-center self-start text-primary underline underline-offset-4">{ti("backInstallments")}</Link>
          </div> : null}
          {loan ? <div className="flex flex-col gap-2"><p className="text-sm text-muted-foreground">{tb("managedTransaction")}</p>
            {transaction.loanId ? <Link href={{ pathname: "/loans", query: { loanId: transaction.loanId } }} onClick={onClose} className="inline-flex min-h-11 items-center self-start text-primary underline underline-offset-4">{tl("openLoan")}</Link> : null}
          </div> : historyLocked ? <HistoricalNote key={`${transaction.id}:${transaction.revision}`} transaction={transaction} onDone={onClose} /> : <div className="grid grid-cols-2 gap-2">
            {transfer ? null : (
              <>
                <Button variant="outline" disabled={pending || conflicted || reloading} className={transaction.installmentId ? "col-span-2" : undefined} onClick={() => onEdit(transaction)}>
                  {t("edit")}
                </Button>
                {transaction.installmentId ? null : <Button variant="outline" disabled={pending || conflicted || reloading} onClick={() => onDuplicate(transaction)}>
                  {t("duplicate")}
                </Button>}
              </>
            )}
            <Button variant="destructive" className="col-span-2" disabled={pending || conflicted || reloading} onClick={remove}>
              {t("delete")}
            </Button>
          </div>}
          {conflicted ? <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm">{tb("conflict")}</p>
            <Button type="button" variant="outline" disabled={reloading || pending} onClick={reloadLatest}>
              {tb("reload")}
            </Button>
          </div> : null}
        </div>
      ) : null}
    </SheetShell>
  );
}

function HistoricalNote({ transaction, onDone }: { transaction: Transaction; onDone: () => void }) {
  const t = useTranslations("Detail");
  const [note, setNote] = useState(transaction.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return <form className="flex min-w-0 flex-col gap-3" onSubmit={(event) => {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = await correctTransactionNote(transaction.id, transaction.revision, { note });
      if (result.ok) onDone();
      else setError(t(result.error === "notConfigured" ? "errorPreview" : result.error === "conflict" ? "historyConflict" : "errorFailed"));
    });
  }}>
    <p className="text-sm text-muted-foreground">{t("historyLocked")}</p>
    <TextField label={t("historyNote")} value={note} maxLength={140} disabled={pending} onChange={(event) => setNote(event.target.value)} />
    {error ? <p role="alert" className="text-sm text-over-foreground">{error}</p> : null}
    <Button type="submit" variant="outline" disabled={pending || note.trim() === (transaction.note ?? "")}>{t("saveHistoryNote")}</Button>
  </form>;
}
