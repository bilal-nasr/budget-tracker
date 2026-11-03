"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useDisplayPrefs } from "@/components/providers/display-prefs";
import { useAppData } from "@/components/providers/app-data";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { payInstallment } from "@/features/installments/actions";
import type { Installment } from "@/features/installments/schema";
import { deleteTransaction } from "@/features/transactions/actions";
import { todayIn } from "@/features/transactions/group";
import { formatAmount, parseAmount, toInputText } from "@/lib/money";
import { cn } from "@/lib/utils";

function Form({ item, onClose }: { item: Installment; onClose: () => void }) {
  const t = useTranslations("Installments");
  const { wallets, timezone } = useAppData();
  const { digits } = useDisplayPrefs();
  const [pending, startTransition] = useTransition();

  // Any active wallet in the installment's currency; the default one comes first.
  const usable = wallets
    .filter((w) => !w.archived && w.currency === item.currency)
    .sort((a, b) => Number(b.id === item.walletId) - Number(a.id === item.walletId));
  const today = todayIn(timezone);

  const [walletId, setWalletId] = useState(usable[0]?.id ?? "");
  const [amount, setAmount] = useState(() =>
    toInputText(Math.min(item.monthlyMinor ?? item.remainingMinor, item.remainingMinor), item.currency),
  );
  const [date, setDate] = useState(today);
  const [showDate, setShowDate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minor = amount.trim() === "" ? null : parseAmount(amount, item.currency);
  const money = (value: number) => `⁦${formatAmount(value, item.currency, { digits })}⁩`;
  const tooMuch = minor !== null && minor > item.remainingMinor;
  const amountError =
    amount.trim() !== "" && minor === null
      ? t("errorAmount")
      : tooMuch
        ? t("tooMuch", { amount: money(item.remainingMinor) })
        : null;
  const canSave = minor !== null && minor > 0 && !tooMuch && walletId !== "" && date !== "";

  const save = () => {
    if (!canSave || minor === null) return;
    setError(null);
    startTransition(async () => {
      const result = await payInstallment({ installmentId: item.id, walletId, amountMinor: minor, occurredOn: date });
      if (!result.ok) {
        setError(
          result.error === "notConfigured"
            ? t("errorPreview")
            : result.error === "exceedsRemaining"
              ? t("tooMuch", { amount: money(item.remainingMinor) })
              : t("errorFailed"),
        );
        return;
      }
      const id = result.id;
      onClose();
      toast(t("recorded"), {
        action: { label: t("undo"), onClick: () => void deleteTransaction(id) },
      });
    });
  };

  if (usable.length === 0) {
    return <p className="py-6 text-center text-[15px] text-muted-foreground">{t("noWalletForCurrency")}</p>;
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <TextField
        label={t("amount")}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode={item.currency === "USD" ? "decimal" : "numeric"}
        autoComplete="off"
        dir="ltr"
        error={amountError}
      />
      <p className="-mt-2 text-[13px] text-muted-foreground">
        {t("leftAfter", { amount: money(Math.max(0, item.remainingMinor - (minor ?? 0))) })}
      </p>

      <div className="flex flex-col gap-1.5">
        <span id="pay-wallet" className="text-sm font-medium">{t("paidFrom")}</span>
        <div role="radiogroup" aria-labelledby="pay-wallet" className="flex flex-wrap gap-2">
          {usable.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={w.id === walletId}
              onClick={() => setWalletId(w.id)}
              className="min-h-11 rounded-full border border-border bg-card px-4 text-sm font-medium aria-checked:border-2 aria-checked:border-foreground aria-checked:bg-accent"
            >
              <bdi>{w.name}</bdi> · {w.currency}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col">
        <button
          type="button"
          aria-expanded={showDate}
          onClick={() => setShowDate((v) => !v)}
          className="flex min-h-12 items-center justify-between text-start text-sm text-muted-foreground"
        >
          <span>{date === today ? t("today") : date}</span>
          <ChevronDown aria-hidden className={cn("size-4 transition-transform", showDate && "rotate-180")} />
        </button>
        {showDate ? (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t("date")}
            <input
              type="date"
              value={date}
              max={today}
              min="2000-01-01"
              onChange={(e) => setDate(e.target.value)}
              className="h-12 rounded-lg border border-input bg-card px-3.5 text-base font-normal"
            />
          </label>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">{error}</p>
      ) : null}

      <Button type="submit" variant="action" size="lg" className="w-full" disabled={!canSave || pending}>
        {pending ? t("recording") : t("record")}
      </Button>
    </form>
  );
}

export function InstallmentPaySheet({ item, onClose }: { item: Installment | null; onClose: () => void }) {
  const t = useTranslations("Installments");
  return (
    <SheetShell
      open={item !== null}
      onOpenChange={(open) => !open && onClose()}
      title={item ? t("payTitle", { name: item.name }) : ""}
    >
      {item ? <Form key={item.id} item={item} onClose={onClose} /> : null}
    </SheetShell>
  );
}
