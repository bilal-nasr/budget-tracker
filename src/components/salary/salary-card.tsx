"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Check, Info } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Amount } from "@/components/money/amount";
import { useDisplayPrefs } from "@/components/providers/display-prefs";
import { formatAmount } from "@/lib/money";
import { useAppData } from "@/components/providers/app-data";
import { useComposer } from "@/components/shell/composer";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { receiveSalary } from "@/features/salary/actions";
import type { SalaryStatus } from "@/features/salary/schema";
import { deleteTransaction } from "@/features/transactions/actions";
import { todayIn } from "@/features/transactions/group";

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
 * saved wallet as income. A second press in the same month asks first.
 */
export function SalaryCard({ status: serverStatus }: { status: SalaryStatus }) {
  const t = useTranslations("Salary");
  const locale = useLocale();
  const { salary, walletById, timezone } = useAppData();
  const { digits } = useDisplayPrefs();
  const { openSalary } = useComposer();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, markReceived] = useOptimistic(serverStatus, (): SalaryStatus => ({
    lastReceivedOn: todayIn(timezone),
    receivedThisMonth: true,
  }));
  const wallet = salary ? walletById(salary.walletId) : undefined;

  if (!salary || !wallet || wallet.archived) {
    return (
      <section aria-labelledby="h-salary" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <div>
          <h2 id="h-salary" className="text-[17px] font-semibold">{t("title")}</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {salary && (!wallet || wallet.archived) ? t("walletGone") : t("setBody")}
          </p>
        </div>
        <Button variant="outline" className="self-start" onClick={openSalary}>
          {t("set")}
        </Button>
      </section>
    );
  }

  const receive = () => {
    setConfirmOpen(false);
    startTransition(async () => {
      markReceived(undefined);
      const result = await receiveSalary();
      if (!result.ok) {
        toast.error(result.error === "notConfigured" ? t("errorPreview") : t("errorFailed"));
        return;
      }
      const id = result.id;
      toast(t("added"), {
        action: {
          label: t("undo"),
          onClick: async () => {
            await deleteTransaction(id);
          },
        },
      });
    });
  };

  return (
    <section aria-labelledby="h-salary" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="h-salary" className="text-[17px] font-semibold">{t("title")}</h2>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {t("goesTo")} <bdi>{wallet.name}</bdi> · {wallet.currency}
          </p>
        </div>
        <Amount minor={salary.amountMinor} currency={wallet.currency} className="text-[22px] font-bold tracking-tight" />
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

      <div className="flex items-center gap-2">
        <Button size="lg" className="flex-1" disabled={pending} onClick={() => setConfirmOpen(true)}>
          {t("got")}
        </Button>
        <Button variant="ghost" onClick={openSalary}>{t("edit")}</Button>
      </div>

      <ConfirmSheet
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
            amount: `⁦${formatAmount(salary.amountMinor, wallet.currency, { digits })}⁩`,
            wallet: `⁨${wallet.name}⁩`,
          })}
        </p>
        {status.receivedThisMonth && status.lastReceivedOn ? (
          <p className="flex items-start gap-2 rounded-lg bg-accent px-3.5 py-2.5 text-[13px]">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t("confirmAlready", { date: shortDate(status.lastReceivedOn, locale) })}
          </p>
        ) : null}
      </ConfirmSheet>
    </section>
  );
}
