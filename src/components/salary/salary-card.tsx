"use client";
import { currencyIntent } from "@/lib/currency-intent";

import { useOptimistic, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { Check, Info, Pencil } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Amount } from "@/components/money/amount";
import { useDisplayPrefs } from "@/components/providers/display-prefs";
import { formatAmount } from "@/lib/money";
import { useRuntimeBalances } from "@/components/add/runtime-balances";
import { useComposer } from "@/components/shell/composer";
import { Button } from "@/components/ui/button";
import { correctSalaryDate, receiveSalary } from "@/features/salary/actions";
import type { ReceiveSalaryInput } from "@/features/installments/cycle-input";
import type { SalaryStatus } from "@/features/salary/schema";
import { deleteTransaction } from "@/features/transactions/actions";
import { todayIn } from "@/features/transactions/group";
import { useRouter } from "@/i18n/navigation";

const ConfirmSheet = dynamic(() => import("@/components/ui/confirm-sheet").then((m) => m.ConfirmSheet));

function shortDate(date: string, locale: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-LB-u-nu-latn" : "en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Fixed monthly salary. One press of "Got salary" adds the saved amount to the
 * saved balance as income. Every confirmed receipt opens an installment cycle.
 */
export function SalaryCard({ status: serverStatus }: { status: SalaryStatus }) {
  const t = useTranslations("Salary");
  const tb = useTranslations("Breakdown");
  const locale = useLocale();
  const router = useRouter();
  const tc = useTranslations("Categories");
  const { salary, balanceChoiceById, timezone, definition } = useRuntimeBalances();
  const { digits } = useDisplayPrefs();
  const { openSalary } = useComposer();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMounted, setConfirmMounted] = useState(false);
  const [draft, setDraft] = useState<ReceiveSalaryInput | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [receiveDate, setReceiveDate] = useState("");
  const [editingDate, setEditingDate] = useState(false);
  const [dateText, setDateText] = useState("");
  const [dateError, setDateError] = useState(false);
  const inFlight = useRef(false);
  const [status, markReceived] = useOptimistic(serverStatus, (previous): SalaryStatus => ({
    ...previous,
    lastReceivedOn: todayIn(timezone),
    receivedThisMonth: true,
  }));
  const balance = salary ? balanceChoiceById(salary.balanceId) : undefined;

  const receive = () => {
    if (!draft || inFlight.current) return;
    inFlight.current = true;
    setConfirmOpen(false);
    startTransition(async () => {
      markReceived(undefined);
      try {
        const result = await receiveSalary(draft);
        if (!result.ok) {
          if (result.error === "failed") { setUncertain(true); toast.error(t("errorUncertain")); return; }
          setUncertain(false);
          setDraft(null);
          if (result.error === "categoryUnavailable") {
            toast.error(t("categoryUnavailable"), { action: { label: tc("title"), onClick: () => router.push("/settings/categories") } });
          } else if (result.error === "cycleChanged" || result.error === "requestAlreadyUsed") {
            toast.error(t("cycleChanged")); router.refresh();
          } else toast.error(result.error === "notConfigured" ? t("errorPreview") : t("errorFailed"));
          return;
        }
        setUncertain(false);
        setDraft(null);
        // The receipt is recorded as of today; move it to the chosen day when that differs.
        if (receiveDate !== "" && receiveDate !== todayIn(timezone)) {
          const moved = await correctSalaryDate(result.id, receiveDate);
          if (!moved.ok) toast.error(t("errorDate"));
          router.refresh();
        }
        toast(t("added"), { action: { label: t("undo"), onClick: async () => {
          const undone = await deleteTransaction(result.id, result.revision);
          if (!undone.ok) toast.error(undone.error === "conflict" ? tb("conflict") : t("errorFailed"));
        } } });
      } catch { setUncertain(true); toast.error(t("errorUncertain")); }
      finally { inFlight.current = false; }
    });
  };
  const openReceive = () => {
    if (!uncertain || !draft) setDraft({ expectedUnits: currencyIntent(balance?.definition), requestId: crypto.randomUUID(), expectedCycleId: serverStatus.receiptId });
    if (!uncertain || !draft) setReceiveDate(todayIn(timezone));
    setConfirmMounted(true);
    setConfirmOpen(true);
  };

  // Reconcile the already-confirmed request before testing eligibility for a
  // NEW receipt. A refresh may remove the salary configuration or its balance
  // after the original income committed but its response was lost.
  if (draft && (uncertain || pending)) {
    return <section aria-labelledby="h-salary" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <h2 id="h-salary" className="text-[17px] font-semibold">{t("title")}</h2>
      <p className="text-[15px] text-muted-foreground">{t(pending ? "cycleHelp" : "errorUncertain")}</p>
      <Button size="lg" loading={pending} onClick={receive}>{t("retrySame")}</Button>
    </section>;
  }

  if (!salary || !balance || balance.archived) {
    return (
      <section aria-labelledby="h-salary" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <div>
          <h2 id="h-salary" className="text-[17px] font-semibold">{t("title")}</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {salary && (!balance || balance.archived) ? t("walletGone") : t("setBody")}
          </p>
        </div>
        <Button variant="outline" className="self-start" onClick={openSalary}>
          {t("set")}
        </Button>
      </section>
    );
  }

  return (
    <section aria-labelledby="h-salary" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="h-salary" className="text-[17px] font-semibold">{t("title")}</h2>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {t("goesTo")} <bdi>{balance.name}</bdi> · {balance.currency}
          </p>
        </div>
        <Amount minor={salary.amountMinor} currency={balance.currency} className="text-[22px] font-bold tracking-tight" />
      </div>

      <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        {status.receivedThisMonth && status.lastReceivedOn ? (
          <>
            <Check aria-hidden className="size-4 text-positive" />
            {t("receivedOn", { date: shortDate(status.lastReceivedOn, locale) })}
          </>
        ) : status.lastReceivedOn ? (
          t("lastOn", { date: shortDate(status.lastReceivedOn, locale) })
        ) : (
          t("never")
        )}
      </p>

      {status.receiptId && status.lastReceivedOn ? (editingDate ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t("receivedDate")}
            <input type="date" value={dateText} max={todayIn(timezone)} min="2000-01-01" onChange={(e) => setDateText(e.target.value)}
              className="h-12 rounded-lg border border-input bg-card px-3.5 text-base font-normal" />
          </label>
          {dateError ? <p role="alert" className="text-sm text-over">{t("errorDate")}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={pending} onClick={() => setEditingDate(false)}>{t("cancel")}</Button>
            <Button loading={pending} disabled={dateText === "" || dateText === status.lastReceivedOn} onClick={() => {
              const id = status.receiptId!;
              setDateError(false);
              startTransition(async () => {
                const result = await correctSalaryDate(id, dateText);
                if (!result.ok) { setDateError(true); return; }
                setEditingDate(false);
                router.refresh();
              });
            }}>{t("saveDate")}</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" className="self-start" disabled={pending || uncertain} onClick={() => { setDateText(status.lastReceivedOn!); setDateError(false); setEditingDate(true); }}>
          <Pencil aria-hidden />{t("changeDate")}
        </Button>
      )) : null}

      <p className="text-[13px] text-muted-foreground">{t(uncertain ? "errorUncertain" : "cycleHelp")}</p>
      <div className="flex items-center gap-2">
        <Button size="lg" className="flex-1" loading={pending} onClick={openReceive}>
          {t(uncertain ? "retrySame" : "got")}
        </Button>
        <Button variant="ghost" disabled={pending || uncertain} onClick={openSalary}>{t("edit")}</Button>
      </div>

      {confirmMounted && <ConfirmSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        onConfirm={receive}
        pending={pending}
      >
        <p>
          {t("confirmBody", {
            amount: `⁦${formatAmount(salary.amountMinor, definition(balance.currency), { digits })}⁩`,
            wallet: `⁨${balance.name}⁩`,
          })}
        </p>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t("receivedDate")}
          <input type="date" value={receiveDate} max={todayIn(timezone)} min="2000-01-01" onChange={(e) => setReceiveDate(e.target.value)}
            className="h-12 rounded-lg border border-input bg-card px-3.5 text-base font-normal" />
        </label>
        {status.lastReceivedOn ? (
          <p className="flex items-start gap-2 rounded-lg bg-accent px-3.5 py-2.5 text-[13px]">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t("confirmAlready", { date: shortDate(status.lastReceivedOn, locale) })}
          </p>
        ) : null}
      </ConfirmSheet>}
    </section>
  );
}
