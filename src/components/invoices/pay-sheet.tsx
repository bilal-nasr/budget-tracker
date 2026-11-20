"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { BalancePicker } from "@/components/add/balance-picker";
import { useRuntimeBalances } from "@/components/add/runtime-balances";
import { useLoanSubmission } from "@/components/loans/use-loan-submission";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { categoryName } from "@/features/categories/catalogue";
import { payItems } from "@/features/invoices/actions";
import { rowDefinition } from "@/features/invoices/display";
import { invoiceErrorKey } from "@/features/invoices/errors";
import { itemsPaySchema, MAX_PAY_CURRENCIES, MAX_PAY_ITEMS, type InvoiceItem, type ItemsPayInput, type PaidRow } from "@/features/invoices/schema";
import { groupByCurrency, lineMinor, totalsByCurrency } from "@/features/invoices/totals";
import { deleteTransaction } from "@/features/transactions/actions";
import type { TransactionMutation } from "@/features/transactions/mutations-core";
import { todayIn } from "@/features/transactions/group";
import type { CurrencyDefinition } from "@/lib/currency";
import { Link, useRouter } from "@/i18n/navigation";
import { fieldSelectClass } from "./category-select";

type Paid = { payments: TransactionMutation[]; rows: PaidRow[] };
/** A currency the payer never enabled still shows, as its own code with the rows' decimals. */
const NO_CATALOG: ReadonlyMap<string, CurrencyDefinition> = new Map();
const groupKey = (group: { currency: string; decimalPlaces: number }) => `${group.currency}:${group.decimalPlaces}`;

/**
 * "Pay": choose where the money comes from, an expense category and the date, then record the
 * rows as an ordinary expense in the payer's own Activity and mark them paid in the folder.
 * Rows in several currencies become one expense per currency, each from a balance of that
 * currency; nothing is ever added across currencies or converted.
 *
 * The rows are the ones this sheet opened with: if they change meanwhile (someone deletes or
 * pays one), the server refuses the whole payment and the sheet asks to review.
 */
export function PaySheet({ folderId, items: opened, onClose, onPaid }: {
  folderId: string;
  /** The unpaid rows to pay. */
  items: InvoiceItem[];
  onClose: () => void;
  onPaid: (rows: PaidRow[]) => void;
}) {
  const t = useTranslations("Invoices");
  const tAdd = useTranslations("Add");
  const locale = useLocale();
  const router = useRouter();
  const { balanceChoices, categories, timezone, currencyByCode, walletContainers, defaultBalanceId } = useRuntimeBalances();
  const formId = useId();
  const categoryId = useId();
  const [items] = useState(opened);
  const groups = groupByCurrency(items).map((group) => {
    const key = groupKey(group);
    const own = currencyByCode(group.currency);
    // Payable only in a currency the payer has enabled with the decimals the rows were priced in.
    const unit = own && !own.disabled && own.decimalPlaces === group.decimalPlaces ? own : undefined;
    const usable = unit ? balanceChoices.filter((balance) => !balance.archived && balance.currency === group.currency) : [];
    return { ...group, key, unit, usable, shown: unit ?? rowDefinition(group, NO_CATALOG), total: totalsByCurrency(group.rows)[0]?.minor ?? null };
  });
  const expense = categories.filter((category) => category.kind === "expense" && category.archivedAt === null);

  // Fixed for this sheet's lifetime: each becomes its expense's id, so a retry never pays twice.
  const [requestIds] = useState(() => new Map(groups.map((group) => [group.key, crypto.randomUUID()])));
  const [balances, setBalances] = useState(() => new Map(groups.map((group) =>
    [group.key, (group.usable.find((balance) => balance.id === defaultBalanceId) ?? group.usable[0])?.id ?? ""])));
  const [category, setCategory] = useState(expense[0]?.id ?? "");
  const [date, setDate] = useState(todayIn(timezone));

  const undo = async (payments: TransactionMutation[]) => {
    // Deleting each expense returns its rows to unpaid (the database does that).
    const results = await Promise.all(payments.map((payment) => deleteTransaction(payment.id, payment.revision).catch(() => null)));
    if (results.some((result) => !result?.ok)) toast.error(t("payUndoFailed"));
  };
  const submission = useLoanSubmission<ItemsPayInput, Paid>(payItems, ({ payments, rows }) => {
    onPaid(rows); onClose();
    toast(t("paidToast", { count: rows.length }), { action: { label: t("undo"), onClick: () => void undo(payments) } });
  });

  const parsed = itemsPaySchema.safeParse({
    expectedUnits: Object.fromEntries(groups.map((group) => [group.currency, group.decimalPlaces])),
    folderId, categoryId: category, occurredOn: date,
    payments: groups.map((group) => ({ requestId: requestIds.get(group.key), balanceId: balances.get(group.key), itemIds: group.rows.map((row) => row.id) })),
  });
  const valid = parsed.success && date <= todayIn(timezone) && expense.some((entry) => entry.id === category)
    && groups.every((group) => group.total !== null && group.usable.some((balance) => balance.id === balances.get(group.key)));
  const many = groups.length > 1;

  return <SheetShell open title={t("payTitle")} description={t(many ? "payHelpMany" : "payHelp")} dismissible={submission.dismissible} onOpenChange={(open) => !open && onClose()}
    footer={submission.review ? <Button className="w-full" onClick={() => { onClose(); router.refresh(); }}>{t("payReview")}</Button> :
      <Button variant="action" size="lg" className="w-full" form={formId} type="submit" loading={submission.pending} disabled={!submission.uncertain && !valid}>
        {t(submission.uncertain ? "payRetry" : "payConfirm")}
      </Button>}>
    <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); submission.submit(valid && parsed.success ? parsed.data : null); }} className="flex flex-col gap-4">
      <fieldset disabled={submission.frozen} className="flex min-w-0 flex-col gap-5 border-0 p-0">
        {groups.map((group) => <section key={group.key} aria-label={t("payGroupLabel", { currency: group.currency })} className="flex min-w-0 flex-col gap-3">
          <ul className="overflow-hidden rounded-xl border border-border">
            {group.rows.map((row) => <li key={row.id} className="flex items-baseline justify-between gap-3 border-b border-border px-3.5 py-2.5">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <bdi>{row.name}</bdi>
                {row.quantity > 1 ? <span className="block text-[13px] text-muted-foreground">
                  <bdi dir="ltr">{row.quantity} × <Amount minor={row.priceMinor} currency={group.shown} /></bdi>
                </span> : null}
              </span>
              <Amount minor={lineMinor(row)} currency={group.shown} className="shrink-0 text-[15px]" />
            </li>)}
            <li className="flex items-baseline justify-between gap-3 bg-secondary px-3.5 py-3 font-semibold">
              <span>{t("payTotal")}</span>
              {group.total === null
                ? <span className="text-[15px] font-normal">{t.rich("totalTooLarge", { currency: group.currency, bdi: (chunks) => <bdi dir="ltr">{chunks}</bdi> })}</span>
                : <Amount minor={group.total} currency={group.shown} className="text-[17px]" />}
            </li>
          </ul>
          {!group.unit ? <p role="status" className="text-sm">{t.rich("payNoCurrency", { currency: group.currency, bdi: (chunks) => <bdi dir="ltr">{chunks}</bdi> })}</p>
            : group.usable.length ? <BalancePicker label={many ? t("payFromIn", { currency: group.currency }) : t("payFrom")} currencyLabel={tAdd("walletCurrency")}
              wallets={walletContainers} currencies={[group.unit]} value={balances.get(group.key) ?? ""}
              onChange={(id) => setBalances((current) => new Map(current).set(group.key, id))} />
            : <p role="status" className="text-sm">{t("payNoWallet")} <Link href="/wallets" className="inline-flex min-h-11 items-center underline underline-offset-4">{t("payWallets")}</Link></p>}
          {group.rows.length > MAX_PAY_ITEMS ? <p role="status" className="text-sm">{t("payTooMany", { max: MAX_PAY_ITEMS })}</p> : null}
        </section>)}
        {groups.length > MAX_PAY_CURRENCIES ? <p role="status" className="text-sm">{t("payTooManyCurrencies", { max: MAX_PAY_CURRENCIES })}</p> : null}
        {expense.length ? <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={categoryId} className="text-sm font-medium">{t("payCategory")}</label>
          <select id={categoryId} className={fieldSelectClass} value={category} onChange={(event) => setCategory(event.target.value)}>
            {expense.map((entry) => <option key={entry.id} value={entry.id}>{categoryName(entry, locale)}</option>)}
          </select>
        </div> : <p role="status" className="text-sm">{t("payNoCategory")} <Link href="/settings/categories" className="inline-flex min-h-11 items-center underline underline-offset-4">{t("payCategories")}</Link></p>}
        <TextField label={t("payDate")} type="date" min="2000-01-01" max={todayIn(timezone)} value={date} onChange={(event) => setDate(event.target.value)} required />
      </fieldset>
      {submission.error ? <p role="alert" className="text-sm text-over">{t(submission.uncertain ? "payUncertain" : invoiceErrorKey(submission.error))}</p> : null}
    </form>
  </SheetShell>;
}
