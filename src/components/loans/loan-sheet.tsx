"use client";
import { currencyIntent } from "@/lib/currency-intent";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useRuntimeBalances, useMoneyDraftUnit } from "@/components/add/runtime-balances";
import { Amount } from "@/components/money/amount";
import { CategorySelect } from "@/components/categories/category-select";
import { SheetShell } from "@/components/ui/sheet-shell";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { BalancePicker } from "@/components/add/balance-picker";
import { calculateLoanFee, calculateLoanPaymentPlan, parseLoanPaymentCount, parsePercentBps, percentInput } from "@/features/loans/calculations";
import { loanCreateSchema, loanEditSchema, type Loan, type LoanDirection, type LoanCreateInput, type LoanEditInput } from "@/features/loans/schema";
import { createLoan, updateLoan } from "@/features/loans/actions";
import { loanErrorKey } from "@/features/loans/errors";
import { todayIn } from "@/features/transactions/group";
import { parseAmount, toInputText } from "@/lib/money";
import { activeCategories } from "@/features/categories/catalogue";
import { useRouter } from "@/i18n/navigation";
import { useLoanSubmission } from "./use-loan-submission";

type Attempt = { kind: "create"; input: LoanCreateInput } | { kind: "edit"; id: string; input: LoanEditInput };

export function LoanSheet({ item, onClose }: { item: Loan | null; onClose: () => void }) {
  const t = useTranslations("Loans");
  const tBalance = useTranslations("Add");
  const currencyLabel = tBalance("walletCurrency");
  const router = useRouter();
  const { balanceChoices: wallets, categories, timezone, definition, walletContainers, enabledCurrencies, defaultBalanceId } = useRuntimeBalances();
  const usable = wallets.filter((w) => !w.archived && (!item || w.currency === item.currency));
  const formId = useId();
  const [requestId] = useState(() => crypto.randomUUID());
  const [direction, setDirection] = useState<LoanDirection>(item?.direction ?? "borrowed");
  const [name, setName] = useState(item?.name ?? "");
  const [balanceId, setBalanceId] = useState(item?.balanceId ?? (usable.find((balance) => balance.id === defaultBalanceId) ?? usable[0])?.id ?? "");
  const [categoryId, setCategoryId] = useState(item?.feeCategoryId ?? "");
  const [principal, setPrincipal] = useState("");
  const [percentage, setPercentage] = useState(item ? percentInput(item.feeBps) : "0");
  const [mode, setMode] = useState<"new" | "existing" | "">("");
  const [principalBefore, setPrincipalBefore] = useState("");
  const [feeBefore, setFeeBefore] = useState("");
  const [monthly, setMonthly] = useState(item?.monthlyPaymentMinor != null ? toInputText(item.monthlyPaymentMinor, definition(item.currency)) : "");
  const [count, setCount] = useState(item?.paymentCount != null ? String(item.paymentCount) : "");
  const [date, setDate] = useState(todayIn(timezone));
  const submission = useLoanSubmission<Attempt, { id?: string }>((attempt) => attempt.kind === "create" ? createLoan(attempt.input) : updateLoan(attempt.id, attempt.input), onClose);
  const balance = wallets.find((w) => w.id === balanceId);
  useMoneyDraftUnit(balance?.definition, () => { setPrincipal(""); setPrincipalBefore(""); setFeeBefore(""); setMonthly(""); setCount(""); }, usable.some((balance) => balance.id === balanceId));
  const choices = activeCategories(categories, direction === "borrowed" ? "expense" : "income");
  const amount = balance ? parseAmount(principal, definition(balance.currency)) : null;
  const bps = parsePercentBps(percentage);
  const fee = amount !== null && bps !== null ? calculateLoanFee(amount, bps) : null;
  const openingPrincipal = !principalBefore.trim() ? 0 : balance ? parseAmount(principalBefore, definition(balance.currency)) : null;
  const openingFee = !feeBefore.trim() ? 0 : balance ? parseAmount(feeBefore, definition(balance.currency)) : null;
  const hasPlan = !!monthly.trim() || !!count.trim();
  const monthlyPaymentMinor = monthly.trim() && balance ? parseAmount(monthly, definition(balance.currency)) : null;
  const paymentCount = parseLoanPaymentCount(count);
  const totalDueMinor = item?.totalDueMinor ?? fee?.totalDueMinor;
  const plan = hasPlan && totalDueMinor != null && monthlyPaymentMinor !== null && paymentCount !== null ? calculateLoanPaymentPlan(totalDueMinor, monthlyPaymentMinor, paymentCount) : null;
  const planValid = !hasPlan || plan !== null;
  const preferences = { monthlyPaymentMinor, paymentCount: hasPlan ? paymentCount : null };
  const edit = loanEditSchema.safeParse({ expectedUnits: currencyIntent(balance?.definition), name, balanceId: balanceId, feeCategoryId: categoryId, ...preferences });
  const input = { expectedUnits: currencyIntent(balance?.definition), requestId, name, direction, balanceId: balanceId, feeCategoryId: categoryId, principalMinor: amount, feeBps: bps,
    openedOn: date, creationMode: mode, principalPaidBeforeMinor: mode === "existing" ? openingPrincipal : 0,
    feePaidBeforeMinor: mode === "existing" ? openingFee : 0, ...preferences };
  const parsed = loanCreateSchema.safeParse(input);
  const valid = usable.some((balance) => balance.id === balanceId) && planValid && (item ? edit.success && usable.some((w) => w.id === balanceId) && choices.some((c) => c.id === categoryId)
    : parsed.success && date <= todayIn(timezone) && choices.some((c) => c.id === categoryId));
  const save = () => {
    const attempt: Attempt | null = !valid ? null : item ? { kind: "edit", id: item.id, input: edit.success ? edit.data : { name, balanceId: balanceId, feeCategoryId: categoryId } } : parsed.success ? { kind: "create", input: parsed.data } : null;
    submission.submit(attempt);
  };
  return <SheetShell open dismissible={submission.dismissible} onOpenChange={(open) => !open && submission.dismissible && onClose()} title={item ? t("edit") : t("add")}
    footer={submission.review ? <Button className="w-full" onClick={() => { onClose(); router.refresh(); }}>{t("reviewLatest")}</Button>
      : <Button form={formId} type="submit" variant="action" size="lg" className="w-full" loading={submission.pending} disabled={!submission.uncertain && !valid}>{t(submission.uncertain ? "retrySame" : item ? "saveChanges" : "save")}</Button>}>
    <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-4">
      <fieldset disabled={submission.frozen} className="flex min-w-0 flex-col gap-4 border-0 p-0">
      {!usable.length ? <p role="status">{t("noWallet")}</p> : null}
      {!item ? <fieldset className="flex flex-wrap gap-2"><legend className="sr-only">{t("title")}</legend>
        {(["borrowed", "lent"] as const).map((value) => <label key={value} className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-border px-3">
          <input type="radio" name={`${formId}-direction`} checked={direction === value} onChange={() => { setDirection(value); setCategoryId(""); }} />{t(value)}
        </label>)}
      </fieldset> : <p className="text-muted-foreground">{t(item.direction)}</p>}
      <TextField label={t("name")} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      <BalancePicker currencyLabel={currencyLabel} label={t("wallet")} wallets={walletContainers} currencies={enabledCurrencies.filter((entry) => !item || entry.code === item.currency)} value={balanceId} onChange={(value) => {
        if (wallets.find((balance) => balance.id === value)?.currency !== balance?.currency) { setPrincipal(""); setPrincipalBefore(""); setFeeBefore(""); setMonthly(""); setCount(""); }
        setBalanceId(value);
      }} />
      {!item ? <>
        <TextField label={t("principal")} value={principal} onChange={(e) => setPrincipal(e.target.value)} inputMode={balance && definition(balance.currency).decimalPlaces === 0 ? "numeric" : "decimal"} dir="ltr" autoComplete="off" />
        <TextField label={t("percent")} value={percentage} onChange={(e) => setPercentage(e.target.value)} inputMode="decimal" dir="ltr" autoComplete="off" error={percentage.trim() && bps === null ? t("invalidPercent") : null} />
        {fee && balance ? <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-y border-border py-3 text-[15px]">
          <dt>{t("fee")}</dt><dd><Amount minor={fee.feeMinor} currency={balance.currency} /></dd>
          <dt className="font-semibold">{t("total")}</dt><dd className="font-semibold"><Amount minor={fee.totalDueMinor} currency={balance.currency} /></dd>
        </dl> : null}
        <fieldset className="flex flex-col gap-2"><legend className="mb-2 text-sm font-medium">{t("movement")}</legend>
          {(["new", "existing"] as const).map((value) => <label key={value} className="flex min-h-12 items-center gap-3 rounded-lg border border-border px-3 py-2">
            <input type="radio" name={`${formId}-mode`} checked={mode === value} onChange={() => setMode(value)} />{t(value)}
          </label>)}
        </fieldset>
        {mode === "existing" ? <>
          <p className="text-sm text-muted-foreground">{t("existingHelp")}</p>
          <TextField label={t("principalBefore")} value={principalBefore} onChange={(e) => setPrincipalBefore(e.target.value)} inputMode={balance && definition(balance.currency).decimalPlaces === 0 ? "numeric" : "decimal"} dir="ltr" />
          <TextField label={t("feeBefore")} value={feeBefore} onChange={(e) => setFeeBefore(e.target.value)} inputMode={balance && definition(balance.currency).decimalPlaces === 0 ? "numeric" : "decimal"} dir="ltr" />
        </> : mode === "new" && balance ? <p className="text-sm text-muted-foreground">{t(direction === "borrowed" ? "cashIn" : "cashOut")} <bdi>{balance.name}</bdi>{amount !== null ? <> · <Amount minor={amount} currency={balance.currency} /></> : null}</p> : null}
        <TextField label={t("date")} type="date" min="2000-01-01" max={todayIn(timezone)} value={date} onChange={(e) => setDate(e.target.value)} />
      </> : <p className="text-sm text-muted-foreground">{t("termsLocked")}</p>}
      <div className="flex flex-col gap-3 border-y border-border py-4">
        <TextField label={t("monthlyPayment")} value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode={balance && definition(balance.currency).decimalPlaces === 0 ? "numeric" : "decimal"} />
        <TextField label={t("paymentCount")} value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" description={t("countHelp")} error={hasPlan && !planValid ? t("invalidPlan") : null} />
        {plan && balance ? <dl className="flex flex-wrap justify-between gap-2 text-sm"><dt>{t("finalPayment")}</dt><dd data-testid="loan-final-payment" className="font-semibold"><Amount minor={plan.finalPaymentMinor} currency={balance.currency} /></dd></dl> : null}
        <p className="text-[13px] text-muted-foreground">{t("planHelp")}</p>
      </div>
      <CategorySelect label={t("category")} placeholder={t("chooseCategory")} categories={choices} value={categoryId} onChange={setCategoryId} />
      {!choices.length ? <p role="status" className="text-sm text-muted-foreground">{t("noCategory")}</p> : null}
      </fieldset>
      {submission.error ? <p role="alert" className="text-sm">{t(submission.uncertain ? "errorUncertain" : loanErrorKey(submission.error))}</p> : null}
    </form>
  </SheetShell>;
}
