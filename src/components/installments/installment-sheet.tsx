"use client";
import { useRouter } from "@/i18n/navigation";
import { currencyIntent } from "@/lib/currency-intent";

import { BalancePicker } from "@/components/add/balance-picker";
import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { CategorySelect } from "@/components/categories/category-select";
import { categoryOptions } from "@/features/categories/catalogue";
import { useRuntimeBalances, useMoneyDraftUnit } from "@/components/add/runtime-balances";
import { InstallmentHistory } from "./installment-history";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { createInstallment, deleteInstallment, updateInstallment } from "@/features/installments/actions";
import type { Installment } from "@/features/installments/schema";
import { parseAmount, toInputText } from "@/lib/money";
import { parseOptionalDay } from "@/lib/numeric-text";
import { cn } from "@/lib/utils";

export type InstallmentSheetState = { item: Installment };

/** Create (item is null) or edit an installment. Rendered inside the Fixed sheet and the edit sheet. */
export function InstallmentForm({ item, onClose }: { item: Installment | null; onClose: () => void }) {
  const router = useRouter();
  const t = useTranslations("Installments");
  const tBalance = useTranslations("Add");
  const currencyLabel = tBalance("walletCurrency");
  const tCurrencies = useTranslations("Currencies");
  const tc = useTranslations("Categories");
  const tAdd = useTranslations("Add");
  const { balanceChoices: wallets, categories, balanceChoiceById, definition, walletContainers, enabledCurrencies, defaultBalanceId } = useRuntimeBalances();
  const [pending, startTransition] = useTransition();

  // On edit the currency is locked, so only wallets in it are offered.
  const usable = wallets.filter(
    (w) => (!w.archived || w.id === item?.balanceId) && (item === null || w.currency === item.currency),
  );
  const expenseCategories = categoryOptions(categories, "expense", item?.categoryId);

  const [name, setName] = useState(item?.name ?? "");
  const [balanceId, setBalanceId] = useState(item?.balanceId ?? (usable.find((balance) => balance.id === defaultBalanceId) ?? usable[0])?.id ?? "");
  const wallet = balanceChoiceById(balanceId);
  const currency = item?.currency ?? wallet?.currency ?? enabledCurrencies[0]?.code ?? "";
  const asText = (minor: number | null | undefined) => (minor ? toInputText(minor, definition(currency)) : "");
  const [total, setTotal] = useState(asText(item?.totalMinor));
  const [paidBefore, setPaidBefore] = useState(asText(item?.paidBeforeMinor));
  const [showBefore, setShowBefore] = useState((item?.paidBeforeMinor ?? 0) > 0);
  const [monthly, setMonthly] = useState(asText(item?.monthlyMinor));
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "");
  const [dueDay, setDueDay] = useState(item?.dueDay ? String(item.dueDay) : "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useMoneyDraftUnit(definition(currency), () => { setTotal(""); setPaidBefore(""); setMonthly(""); }, wallet !== undefined && !wallet.archived);
  const parse = (text: string) => (text.trim() === "" ? null : parseAmount(text, definition(currency)));
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
    wallet !== undefined && !wallet.archived && expenseCategories.some((c) => c.id === categoryId) && !dayError;

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        if (result.error === "conflict") { setTotal(""); setPaidBefore(""); setMonthly(""); router.refresh(); }
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
        const input = { expectedUnits: currencyIntent(definition(currency)),
          name: name.trim(),
          totalMinor,
          paidBeforeMinor,
          balanceId: balanceId,
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
        inputMode={definition(currency).decimalPlaces === 0 ? "numeric" : "decimal"}
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
              inputMode={definition(currency).decimalPlaces === 0 ? "numeric" : "decimal"}
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
<BalancePicker currencyLabel={currencyLabel} label={t("defaultWallet")} wallets={walletContainers} currencies={enabledCurrencies.filter((entry) => !item || entry.code === item.currency)} value={balanceId} onChange={(id) => {
            if (balanceChoiceById(id)?.currency !== currency) { setTotal(""); setPaidBefore(""); setMonthly(""); }
            setBalanceId(id);
          }} />
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
          inputMode={definition(currency).decimalPlaces === 0 ? "numeric" : "decimal"}
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
          <InstallmentHistory key={`${item.id}:${item.paidMinor}:${item.cycleLatestPaymentId}`} item={item} onClose={onClose} />
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
