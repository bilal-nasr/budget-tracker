"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { CategorySelect } from "@/components/categories/category-select";
import { categoryOptions } from "@/features/categories/schema";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { useComposer } from "@/components/shell/composer";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { createInstallment, deleteInstallment, updateInstallment } from "@/features/installments/actions";
import type { Installment } from "@/features/installments/schema";
import { CURRENCY_DECIMALS, parseAmount, toInputText, type Currency } from "@/lib/money";
import { parseOptionalDay } from "@/lib/numeric-text";
import { cn } from "@/lib/utils";

export type InstallmentSheetState = { item: Installment };

function shortDate(date: string, locale: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-LB-u-nu-latn" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Create (item is null) or edit an installment. Rendered inside the Fixed sheet and the edit sheet. */
export function InstallmentForm({ item, onClose }: { item: Installment | null; onClose: () => void }) {
  const t = useTranslations("Installments");
  const tCurrencies = useTranslations("Currencies");
  const tc = useTranslations("Categories");
  const tAdd = useTranslations("Add");
  const locale = useLocale();
  const { wallets, categories, walletById } = useAppData();
  const { openDetail } = useComposer();
  const [pending, startTransition] = useTransition();

  // On edit the currency is locked, so only wallets in it are offered.
  const usable = wallets.filter(
    (w) => (!w.archived || w.id === item?.walletId) && (item === null || w.currency === item.currency),
  );
  const expenseCategories = categoryOptions(categories, "expense", item?.categoryId);

  const [name, setName] = useState(item?.name ?? "");
  const [walletId, setWalletId] = useState(item?.walletId ?? usable[0]?.id ?? "");
  const wallet = walletById(walletId);
  const currency: Currency = item?.currency ?? wallet?.currency ?? "USD";
  const asText = (minor: number | null | undefined) => (minor ? toInputText(minor, currency) : "");
  const [total, setTotal] = useState(asText(item?.totalMinor));
  const [paidBefore, setPaidBefore] = useState(asText(item?.paidBeforeMinor));
  const [showBefore, setShowBefore] = useState((item?.paidBeforeMinor ?? 0) > 0);
  const [monthly, setMonthly] = useState(asText(item?.monthlyMinor));
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "");
  const [dueDay, setDueDay] = useState(item?.dueDay ? String(item.dueDay) : "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parse = (text: string) => (text.trim() === "" ? null : parseAmount(text, currency));
  const totalMinor = parse(total);
  const paidBeforeMinor = paidBefore.trim() === "" ? 0 : parse(paidBefore);
  const monthlyMinor = parse(monthly);
  const bad = (text: string, value: number | null) => text.trim() !== "" && value === null;
  const { value: dayNumber, invalid: invalidDay } = parseOptionalDay(dueDay);
  const dayError = invalidDay ? t("errorDay") : null;
  const beforeError =
    bad(paidBefore, paidBeforeMinor)
      ? t("errorAmount")
      : paidBeforeMinor !== null && totalMinor !== null && paidBeforeMinor > totalMinor
        ? t("errorPaidBefore")
        : null;
  const canSave =
    name.trim() !== "" &&
    totalMinor !== null && totalMinor > 0 &&
    paidBeforeMinor !== null && !beforeError &&
    !bad(monthly, monthlyMinor) && (monthlyMinor === null || monthlyMinor > 0) &&
    wallet !== undefined && expenseCategories.some((c) => c.id === categoryId) && !dayError;

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(
          result.error === "notConfigured"
            ? t("errorPreview")
            : result.error === "totalBelowPaid"
              ? t("errorTotalBelowPaid")
              : result.error === "categoryUnavailable" ? tc("errorUnavailable") : t("errorFailed"),
        );
        setConfirmDelete(false);
        return;
      }
      onClose();
    });
  };

  if (usable.length === 0) {
    return <p className="py-6 text-center text-[15px] text-muted-foreground">{t("needWallet")}</p>;
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave || totalMinor === null || paidBeforeMinor === null) return;
        const input = {
          name: name.trim(),
          totalMinor,
          paidBeforeMinor,
          walletId,
          categoryId,
          monthlyMinor,
          dueDay: dayNumber,
        };
        run(() => (item ? updateInstallment(item.id, input) : createInstallment(input)));
      }}
    >
      <TextField
        label={t("name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        placeholder={t("namePlaceholder")}
        autoComplete="off"
        required
      />
      <TextField
        label={t("total")}
        value={total}
        onChange={(e) => setTotal(e.target.value)}
        inputMode={CURRENCY_DECIMALS[currency] === 0 ? "numeric" : "decimal"}
        placeholder="0"
        autoComplete="off"
        dir="ltr"
        error={bad(total, totalMinor) ? t("errorAmount") : null}
      />

      <div className="flex flex-col">
        <button
          type="button"
          aria-expanded={showBefore}
          onClick={() => setShowBefore((v) => !v)}
          className="flex min-h-11 items-center justify-between text-start text-sm text-muted-foreground"
        >
          {t("startedBefore")}
          <ChevronDown aria-hidden className={cn("size-4 transition-transform", showBefore && "rotate-180")} />
        </button>
        {showBefore ? (
          <div className="flex flex-col gap-1">
            <TextField
              label={t("paidBefore")}
              value={paidBefore}
              onChange={(e) => setPaidBefore(e.target.value)}
              inputMode={CURRENCY_DECIMALS[currency] === 0 ? "numeric" : "decimal"}
              placeholder="0"
              autoComplete="off"
              dir="ltr"
              error={beforeError}
            />
            <p className="text-[13px] text-muted-foreground">{t("paidBeforeHelp")}</p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <span id="in-wallet" className="text-sm font-medium">{t("defaultWallet")}</span>
        <div role="radiogroup" aria-labelledby="in-wallet" className="flex flex-wrap gap-2">
          {usable.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={w.id === walletId}
              onClick={() => {
                if (w.currency !== currency) {
                  setTotal(""); setPaidBefore(""); setMonthly("");
                }
                setWalletId(w.id);
              }}
              className="min-h-11 rounded-full border border-border bg-card px-4 text-sm font-medium aria-checked:border-2 aria-checked:border-foreground aria-checked:bg-accent"
            >
              <bdi>{w.name}</bdi> · {w.currency}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-muted-foreground">{t("defaultWalletHelp")}</p>
        <p className="text-[13px] text-muted-foreground">{tCurrencies("reenterAmount", { currency })}</p>
      </div>

      <CategorySelect
        categories={expenseCategories}
        value={categoryId}
        onChange={setCategoryId}
        label={t("category")}
        placeholder={tAdd("categoryPlaceholder")}
      />

      <div className="flex flex-col gap-1">
        <TextField
          label={t("monthlyAmount")}
          value={monthly}
          onChange={(e) => setMonthly(e.target.value)}
          inputMode={CURRENCY_DECIMALS[currency] === 0 ? "numeric" : "decimal"}
          placeholder="0"
          autoComplete="off"
          dir="ltr"
          error={bad(monthly, monthlyMinor) ? t("errorAmount") : null}
        />
        <p className="text-[13px] text-muted-foreground">{t("monthlyHelp")}</p>
      </div>
      <TextField
        label={t("dueDay")}
        value={dueDay}
        onChange={(e) => setDueDay(e.target.value)}
        inputMode="numeric"
        placeholder="1 - 31"
        autoComplete="off"
        dir="ltr"
        error={dayError}
      />

      {error ? (
        <p role="alert" className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">{error}</p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={pending || !canSave}>
        {item ? t("saveChanges") : t("save")}
      </Button>

      {item ? (
        <>
          <section aria-labelledby="in-history" className="flex flex-col gap-1 border-t border-border pt-4">
            <h3 id="in-history" className="text-sm font-medium">{t("history")}</h3>
            {item.payments.length === 0 && item.paidBeforeMinor === 0 ? (
              <p className="text-[15px] text-muted-foreground">{t("historyEmpty")}</p>
            ) : (
              <ul className="flex flex-col">
                {item.payments.map((p) => (
                  <li key={p.transactionId} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (!p.transaction) return;
                        onClose();
                        openDetail(p.transaction);
                      }}
                      disabled={!p.transaction}
                      className="flex min-h-12 w-full items-center justify-between gap-3 text-start disabled:opacity-50"
                    >
                      <span className="min-w-0 truncate text-[15px]">
                        {shortDate(p.occurredOn, locale)} · <bdi>{walletById(p.walletId)?.name}</bdi>
                      </span>
                      <Amount minor={p.amountMinor} currency={item.currency} className="shrink-0 font-semibold" />
                    </button>
                  </li>
                ))}
                {item.paidBeforeMinor > 0 ? (
                  <li className="flex min-h-12 items-center justify-between gap-3 text-[15px] text-muted-foreground">
                    <span>{t("beforeApp")}</span>
                    <Amount minor={item.paidBeforeMinor} currency={item.currency} className="shrink-0" />
                  </li>
                ) : null}
              </ul>
            )}
          </section>
          <Button type="button" variant="ghost" className="text-over" onClick={() => setConfirmDelete(true)}>
            {t("delete")}
          </Button>
          <ConfirmSheet
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title={t("deleteTitle", { name: item.name })}
            confirmLabel={t("delete")}
            cancelLabel={t("cancel")}
            onConfirm={() => run(() => deleteInstallment(item.id))}
            pending={pending}
            tone="danger"
          >
            <p>{t("deleteBody")}</p>
          </ConfirmSheet>
        </>
      ) : null}
    </form>
  );
}

/** Edit sheet for an existing installment (opened from its row). */
export function InstallmentSheet({ state, onClose }: { state: InstallmentSheetState | null; onClose: () => void }) {
  const t = useTranslations("Installments");
  return (
    <SheetShell open={state !== null} onOpenChange={(open) => !open && onClose()} title={t("editTitle")}>
      {state ? <InstallmentForm key={state.item.id} item={state.item} onClose={onClose} /> : null}
    </SheetShell>
  );
}
