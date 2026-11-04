"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useAppData } from "@/components/providers/app-data";
import { Amount } from "@/components/money/amount";
import { CategorySelect } from "@/components/categories/category-select";
import { SheetShell } from "@/components/ui/sheet-shell";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { calculateLoanFee, parsePercentBps, percentInput } from "@/features/loans/calculations";
import { loanCreateSchema, type Loan, type LoanDirection, type LoanCreateInput, type LoanEditInput } from "@/features/loans/schema";
import { createLoan, updateLoan } from "@/features/loans/actions";
import { loanErrorKey } from "@/features/loans/errors";
import { todayIn } from "@/features/transactions/group";
import { CURRENCY_DECIMALS, parseAmount } from "@/lib/money";
import { activeCategories } from "@/features/categories/schema";
import { useRouter } from "@/i18n/navigation";
import { useLoanSubmission } from "./use-loan-submission";

type Attempt = { kind: "create"; input: LoanCreateInput } | { kind: "edit"; id: string; input: LoanEditInput };

export function LoanSheet({ item, onClose }: { item: Loan | null; onClose: () => void }) {
  const t = useTranslations("Loans");
  const router = useRouter();
  const { wallets, categories, timezone } = useAppData();
  const usable = wallets.filter((w) => !w.archived && (!item || w.currency === item.currency));
  const formId = useId();
  const [requestId] = useState(() => crypto.randomUUID());
  const [direction, setDirection] = useState<LoanDirection>(item?.direction ?? "borrowed");
  const [name, setName] = useState(item?.name ?? "");
  const [walletId, setWalletId] = useState(item?.walletId ?? usable[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(item?.feeCategoryId ?? "");
  const [principal, setPrincipal] = useState("");
  const [percentage, setPercentage] = useState(item ? percentInput(item.feeBps) : "0");
  const [mode, setMode] = useState<"new" | "existing" | "">("");
  const [principalBefore, setPrincipalBefore] = useState("");
  const [feeBefore, setFeeBefore] = useState("");
  const [date, setDate] = useState(todayIn(timezone));
  const submission = useLoanSubmission<Attempt, { id?: string }>((attempt) => attempt.kind === "create" ? createLoan(attempt.input) : updateLoan(attempt.id, attempt.input), onClose);
  const wallet = wallets.find((w) => w.id === walletId);
  const choices = activeCategories(categories, direction === "borrowed" ? "expense" : "income");
  const amount = wallet ? parseAmount(principal, wallet.currency) : null;
  const bps = parsePercentBps(percentage);
  const fee = amount !== null && bps !== null ? calculateLoanFee(amount, bps) : null;
  const openingPrincipal = !principalBefore.trim() ? 0 : wallet ? parseAmount(principalBefore, wallet.currency) : null;
  const openingFee = !feeBefore.trim() ? 0 : wallet ? parseAmount(feeBefore, wallet.currency) : null;
  const input = { requestId, name, direction, walletId, feeCategoryId: categoryId, principalMinor: amount, feeBps: bps,
    openedOn: date, creationMode: mode, principalPaidBeforeMinor: mode === "existing" ? openingPrincipal : 0,
    feePaidBeforeMinor: mode === "existing" ? openingFee : 0 };
  const parsed = loanCreateSchema.safeParse(input);
  const valid = item ? name.trim().length > 0 && name.trim().length <= 60 && usable.some((w) => w.id === walletId) && choices.some((c) => c.id === categoryId)
    : parsed.success && date <= todayIn(timezone) && choices.some((c) => c.id === categoryId);
  const save = () => {
    const attempt: Attempt | null = !valid ? null : item ? { kind: "edit", id: item.id, input: { name, walletId, feeCategoryId: categoryId } } : parsed.success ? { kind: "create", input: parsed.data } : null;
    submission.submit(attempt);
  };
  return <SheetShell open dismissible={submission.dismissible} onOpenChange={(open) => !open && submission.dismissible && onClose()} title={item ? t("edit") : t("add")}
    footer={submission.review ? <Button className="w-full" onClick={() => { onClose(); router.refresh(); }}>{t("reviewLatest")}</Button>
      : <Button form={formId} type="submit" variant="action" size="lg" className="w-full" disabled={submission.pending || (!submission.uncertain && !valid)}>{t(submission.uncertain ? "retrySame" : item ? "saveChanges" : "save")}</Button>}>
    <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-4">
      <fieldset disabled={submission.frozen} className="flex min-w-0 flex-col gap-4 border-0 p-0">
      {!usable.length ? <p role="status">{t("noWallet")}</p> : null}
      {!item ? <fieldset className="flex flex-wrap gap-2"><legend className="sr-only">{t("title")}</legend>
        {(["borrowed", "lent"] as const).map((value) => <label key={value} className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-border px-3">
          <input type="radio" name={`${formId}-direction`} checked={direction === value} onChange={() => { setDirection(value); setCategoryId(""); }} />{t(value)}
        </label>)}
      </fieldset> : <p className="text-muted-foreground">{t(item.direction)}</p>}
      <TextField label={t("name")} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      <label className="flex flex-col gap-1.5 text-sm font-medium">{t("wallet")}
        <Select value={walletId || null} onValueChange={(value) => {
          if (typeof value !== "string") return;
          if (wallets.find((w) => w.id === value)?.currency !== wallet?.currency) { setPrincipal(""); setPrincipalBefore(""); setFeeBefore(""); }
          setWalletId(value);
        }}><SelectTrigger aria-label={t("wallet")}><span className="truncate"><bdi>{wallet?.name}</bdi> · {wallet?.currency}</span></SelectTrigger>
          <SelectContent>{usable.map((w) => <SelectItem key={w.id} value={w.id}><bdi>{w.name}</bdi> · {w.currency}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      {!item ? <>
        <TextField label={t("principal")} value={principal} onChange={(e) => setPrincipal(e.target.value)} inputMode={wallet && CURRENCY_DECIMALS[wallet.currency] === 0 ? "numeric" : "decimal"} dir="ltr" autoComplete="off" />
        <TextField label={t("percent")} value={percentage} onChange={(e) => setPercentage(e.target.value)} inputMode="decimal" dir="ltr" autoComplete="off" error={percentage.trim() && bps === null ? t("invalidPercent") : null} />
        {fee && wallet ? <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-y border-border py-3 text-[15px]">
          <dt>{t("fee")}</dt><dd><Amount minor={fee.feeMinor} currency={wallet.currency} /></dd>
          <dt className="font-semibold">{t("total")}</dt><dd className="font-semibold"><Amount minor={fee.totalDueMinor} currency={wallet.currency} /></dd>
        </dl> : null}
        <fieldset className="flex flex-col gap-2"><legend className="mb-2 text-sm font-medium">{t("movement")}</legend>
          {(["new", "existing"] as const).map((value) => <label key={value} className="flex min-h-12 items-center gap-3 rounded-lg border border-border px-3 py-2">
            <input type="radio" name={`${formId}-mode`} checked={mode === value} onChange={() => setMode(value)} />{t(value)}
          </label>)}
        </fieldset>
        {mode === "existing" ? <>
          <p className="text-sm text-muted-foreground">{t("existingHelp")}</p>
          <TextField label={t("principalBefore")} value={principalBefore} onChange={(e) => setPrincipalBefore(e.target.value)} inputMode={wallet && CURRENCY_DECIMALS[wallet.currency] === 0 ? "numeric" : "decimal"} dir="ltr" />
          <TextField label={t("feeBefore")} value={feeBefore} onChange={(e) => setFeeBefore(e.target.value)} inputMode={wallet && CURRENCY_DECIMALS[wallet.currency] === 0 ? "numeric" : "decimal"} dir="ltr" />
        </> : mode === "new" && wallet ? <p className="text-sm text-muted-foreground">{t(direction === "borrowed" ? "cashIn" : "cashOut")} <bdi>{wallet.name}</bdi>{amount !== null ? <> · <Amount minor={amount} currency={wallet.currency} /></> : null}</p> : null}
        <TextField label={t("date")} type="date" min="2000-01-01" max={todayIn(timezone)} value={date} onChange={(e) => setDate(e.target.value)} />
      </> : <p className="text-sm text-muted-foreground">{t("termsLocked")}</p>}
      <CategorySelect label={t("category")} placeholder={t("chooseCategory")} categories={choices} value={categoryId} onChange={setCategoryId} />
      {!choices.length ? <p role="status" className="text-sm text-muted-foreground">{t("noCategory")}</p> : null}
      </fieldset>
      {submission.error ? <p role="alert" className="text-sm">{t(submission.uncertain ? "errorUncertain" : loanErrorKey(submission.error))}</p> : null}
    </form>
  </SheetShell>;
}
