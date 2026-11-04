"use client";
import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { useLoanSubmission } from "@/components/loans/use-loan-submission";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { recordPendingReceipt } from "@/features/pending-payments/actions";
import { receiptSchema, type PendingPayment, type ReceiptInput } from "@/features/pending-payments/schema";
import { pendingErrorKey } from "@/features/pending-payments/errors";
import { categoryName } from "@/features/categories/catalogue";
import { todayIn } from "@/features/transactions/group";
import { CURRENCY_DECIMALS, parseAmount } from "@/lib/money";
import { Link, useRouter } from "@/i18n/navigation";

export function ReceiptSheet({ item, onClose }: { item: PendingPayment; onClose: () => void }) {
  const t = useTranslations("PendingPayments");
  const locale = useLocale();
  const router = useRouter();
  const { wallets, categories, timezone } = useAppData();
  const usable = wallets.filter((wallet) => !wallet.archived && wallet.currency === item.currency);
  const income = categories.filter((category) => category.kind === "income" && category.archivedAt === null);
  const [requestId] = useState(() => crypto.randomUUID());
  const [text, setText] = useState("");
  const [walletId, setWalletId] = useState(usable[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(income.find((category) => category.nameEn !== "Salary")?.id ?? income[0]?.id ?? "");
  const [date, setDate] = useState(todayIn(timezone));
  const formId = useId();
  const submission = useLoanSubmission<ReceiptInput, { id: string }>(recordPendingReceipt, () => { onClose(); toast(t("recorded")); });
  const amount = parseAmount(text, item.currency);
  const parsed = receiptSchema.safeParse({ requestId, paymentId: item.id, walletId, categoryId, amountMinor: amount, occurredOn: date });
  const valid = parsed.success && amount !== null && amount <= item.remainingMinor && date <= todayIn(timezone)
    && usable.some((wallet) => wallet.id === walletId) && income.some((category) => category.id === categoryId);
  const selectClass = "h-12 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base focus-visible:outline-2 focus-visible:outline-ring";
  return <SheetShell open title={t("receive")} description={<bdi>{item.client} · {item.project}</bdi>} dismissible={submission.dismissible} onOpenChange={(open) => !open && onClose()}
    footer={submission.review ? <Button className="w-full" onClick={() => { onClose(); router.refresh(); }}>{t("review")}</Button> :
      <Button variant="action" size="lg" className="w-full" form={formId} type="submit" disabled={submission.pending || (!submission.uncertain && !valid)}>{t(submission.uncertain ? "retrySame" : "saveReceipt")}</Button>}>
    <form id={formId} className="flex flex-col gap-4" noValidate onSubmit={(event) => { event.preventDefault(); submission.submit(valid && parsed.success ? parsed.data : null); }}>
      <fieldset disabled={submission.frozen} className="flex min-w-0 flex-col gap-4 border-0 p-0">
        <p className="text-sm text-muted-foreground">{t("receiptHelp")}</p>
        <p className="flex flex-wrap justify-between gap-2 text-sm">{t("remaining")} <Amount minor={item.remainingMinor} currency={item.currency} /></p>
        <TextField label={t("receiptAmount")} description={item.currency} value={text} onChange={(event) => setText(event.target.value)} inputMode={CURRENCY_DECIMALS[item.currency] ? "decimal" : "numeric"}
          error={amount !== null && amount > item.remainingMinor ? t("errorTooMuch") : text.trim() && !amount ? t("errorInvalid") : null} required />
        {usable.length ? <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">{t("wallet")}<select className={selectClass} value={walletId} onChange={(event) => setWalletId(event.target.value)}>
          {usable.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name} · {wallet.currency}</option>)}
        </select></label> : <p role="status" className="text-sm">{t("noWallet")} <Link href="/wallets" className="inline-flex min-h-11 items-center underline underline-offset-4">{t("wallets")}</Link></p>}
        {income.length ? <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">{t("category")}<select className={selectClass} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          {income.map((category) => <option key={category.id} value={category.id}>{categoryName(category, locale)}</option>)}
        </select></label> : <p role="status" className="text-sm">{t("noCategory")} <Link href="/settings/categories" className="inline-flex min-h-11 items-center underline underline-offset-4">{t("categories")}</Link></p>}
        <TextField label={t("receiptDate")} type="date" min="2000-01-01" max={todayIn(timezone)} value={date} onChange={(event) => setDate(event.target.value)} required />
        {valid && amount !== null ? <p className="flex flex-wrap justify-between gap-2 border-t border-border pt-3 text-sm">{t("leftAfter")}<Amount minor={item.remainingMinor - amount} currency={item.currency} /></p> : null}
      </fieldset>
      {submission.error ? <p role="alert" className="text-sm">{t(submission.uncertain ? "errorUncertain" : pendingErrorKey(submission.error))}</p> : null}
    </form>
  </SheetShell>;
}
