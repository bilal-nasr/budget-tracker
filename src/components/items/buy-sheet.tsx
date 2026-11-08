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
import { buyItems } from "@/features/items/actions";
import { itemBuySchema, MAX_BUY_ITEMS, type ItemBuyInput, type ShoppingItem } from "@/features/items/schema";
import { itemErrorKey } from "@/features/items/errors";
import { deleteTransaction } from "@/features/transactions/actions";
import type { TransactionMutation } from "@/features/transactions/mutations-core";
import { todayIn } from "@/features/transactions/group";
import { currencyIntent } from "@/lib/currency-intent";
import { sumMinor } from "@/lib/money";
import { Link, useRouter } from "@/i18n/navigation";

/**
 * "I bought this": confirms wallet, category and date, then records one expense in
 * Activity. Several items become one expense whose breakdown lists each of them.
 */
export function BuySheet({ items, onClose, onDone }: { items: ShoppingItem[]; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("Items");
  const tAdd = useTranslations("Add");
  const locale = useLocale();
  const router = useRouter();
  const { balanceChoices, categories, timezone, definition, walletContainers, enabledCurrencies, defaultBalanceId } = useRuntimeBalances();
  const currency = items[0].currency;
  const unit = definition(currency);
  const usable = balanceChoices.filter((balance) => !balance.archived && balance.currency === currency);
  const expense = categories.filter((category) => category.kind === "expense" && category.archivedAt === null);
  const formId = useId();
  const [requestId] = useState(() => crypto.randomUUID());
  const [balanceId, setBalanceId] = useState((usable.find((balance) => balance.id === defaultBalanceId) ?? usable[0])?.id ?? "");
  const [categoryId, setCategoryId] = useState(expense[0]?.id ?? "");
  const [date, setDate] = useState(todayIn(timezone));
  const total = sumMinor(items.map((item) => item.priceMinor));

  const undo = async (purchase: TransactionMutation) => {
    const undone = await deleteTransaction(purchase.id, purchase.revision).catch(() => null);
    if (!undone?.ok) toast.error(t("undoFailed"));
  };
  const submission = useLoanSubmission<ItemBuyInput, TransactionMutation>(buyItems, (purchase) => {
    onDone(); onClose();
    toast(t("recorded"), { action: { label: t("undo"), onClick: () => undo(purchase) } });
  });
  const parsed = itemBuySchema.safeParse({ expectedUnits: currencyIntent(unit), requestId, itemIds: items.map((item) => item.id), balanceId, categoryId, occurredOn: date });
  const valid = parsed.success && !unit.disabled && date <= todayIn(timezone)
    && usable.some((balance) => balance.id === balanceId) && expense.some((category) => category.id === categoryId);
  const selectClass = "h-12 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base focus-visible:outline-2 focus-visible:outline-ring";
  return <SheetShell open title={t("buyTitle")} description={t("buyHelp")} dismissible={submission.dismissible} onOpenChange={(open) => !open && onClose()}
    footer={submission.review ? <Button className="w-full" onClick={() => { onClose(); router.refresh(); }}>{t("review")}</Button> :
      <Button variant="action" size="lg" className="w-full" form={formId} type="submit" loading={submission.pending} disabled={!submission.uncertain && !valid}>{t(submission.uncertain ? "retrySame" : "saveBuy")}</Button>}>
    <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); submission.submit(valid && parsed.success ? parsed.data : null); }} className="flex flex-col gap-4">
      <fieldset disabled={submission.frozen} className="flex min-w-0 flex-col gap-4 border-0 p-0">
        <ul className="overflow-hidden rounded-xl border border-border">
          {items.map((item) => <li key={item.id} className="flex items-baseline justify-between gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0">
            <span className="min-w-0 break-words"><bdi>{item.name}</bdi></span>
            <Amount minor={item.priceMinor} currency={currency} className="shrink-0 text-[15px]" />
          </li>)}
          <li className="flex items-baseline justify-between gap-3 bg-secondary px-3.5 py-3 font-semibold">
            <span>{t("total")}</span><Amount minor={total} currency={currency} className="text-[17px]" />
          </li>
        </ul>
        {usable.length ? <BalancePicker currencyLabel={tAdd("walletCurrency")} label={t("wallet")} wallets={walletContainers} currencies={enabledCurrencies.filter((entry) => entry.code === currency)} value={balanceId} onChange={setBalanceId} />
          : <p role="status" className="text-sm">{t("noWallet")} <Link href="/wallets" className="inline-flex min-h-11 items-center underline underline-offset-4">{t("wallets")}</Link></p>}
        {expense.length ? <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">{t("category")}
          <select className={selectClass} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            {expense.map((category) => <option key={category.id} value={category.id}>{categoryName(category, locale)}</option>)}
          </select></label>
          : <p role="status" className="text-sm">{t("noCategory")} <Link href="/settings/categories" className="inline-flex min-h-11 items-center underline underline-offset-4">{t("categories")}</Link></p>}
        <TextField label={t("date")} type="date" min="2000-01-01" max={todayIn(timezone)} value={date} onChange={(event) => setDate(event.target.value)} required />
      </fieldset>
      {items.length > MAX_BUY_ITEMS ? <p role="status" className="text-sm">{t("tooMany", { max: MAX_BUY_ITEMS })}</p> : null}
      {submission.error ? <p role="alert" className="text-sm">{t(submission.uncertain ? "errorUncertain" : itemErrorKey(submission.error))}</p> : null}
    </form>
  </SheetShell>;
}
