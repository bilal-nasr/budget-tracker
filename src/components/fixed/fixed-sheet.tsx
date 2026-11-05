"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useAppData } from "@/components/providers/app-data";
import { CategorySelect } from "@/components/categories/category-select";
import { categoryOptions } from "@/features/categories/catalogue";
import { InstallmentForm } from "@/components/installments/installment-sheet";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { createFixedExpense, deleteFixedExpense, updateFixedExpense } from "@/features/fixed/actions";
import type { FixedExpense } from "@/features/fixed/schema";
import { CURRENCY_DECIMALS, parseAmount, toInputText } from "@/lib/money";
import { parseOptionalDay } from "@/lib/numeric-text";
import { ExpenseBreakdownFields, useExpenseBreakdownLabels } from "@/components/add/expense-breakdown-fields";
import { parseExpenseItemDrafts, type ExpenseItemDraft } from "@/features/transactions/breakdown";

export type FixedSheetState = { item: FixedExpense | null };

function Form({ item, onClose }: { item: FixedExpense | null; onClose: () => void }) {
  const t = useTranslations("Fixed");
  const tCurrencies = useTranslations("Currencies");
  const tc = useTranslations("Categories");
  const tAdd = useTranslations("Add");
  const tb = useTranslations("Breakdown");
  const breakdownLabels = useExpenseBreakdownLabels();
  const { legacyWallets: wallets, categories, legacyWalletById } = useAppData();
  const [pending, startTransition] = useTransition();
  const usable = wallets.filter((w) => !w.archived || w.id === item?.walletId);
  const expenseCategories = categoryOptions(categories, "expense", item?.categoryId);

  const [name, setName] = useState(item?.name ?? "");
  const [walletId, setWalletId] = useState(item?.walletId ?? usable[0]?.id ?? "");
  const wallet = legacyWalletById(walletId);
  const currency = wallet?.currency ?? "USD";
  const [amount, setAmount] = useState(item && wallet ? toInputText(item.amountMinor, wallet.currency) : "");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "");
  const [dueDay, setDueDay] = useState(item?.dueDay ? String(item.dueDay) : "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemDrafts, setItemDrafts] = useState<ExpenseItemDraft[]>(() => (item?.items ?? []).map((line, index) => ({
    key: `fixed-${index}`, description: line.description, amountText: toInputText(line.amountMinor, currency),
  })));

  const minor = amount.trim() === "" ? null : parseAmount(amount, currency);
  const amountError = amount.trim() !== "" && minor === null ? t("errorAmount") : null;
  const { value: dayNumber, invalid: invalidDay } = parseOptionalDay(dueDay);
  const dayError = invalidDay ? t("errorDay") : null;
  const breakdown = parseExpenseItemDrafts(currency, minor, itemDrafts);
  const canSave =
    name.trim() !== "" && minor !== null && minor > 0 && wallet !== undefined && expenseCategories.some((c) => c.id === categoryId) && !dayError && breakdown.valid;

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error === "notConfigured" ? t("errorPreview") : result.error === "categoryUnavailable" ? tc("errorUnavailable") : t("errorFailed"));
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
        if (!canSave || minor === null || !breakdown.valid) return;
        const input = { name: name.trim(), amountMinor: minor, walletId, categoryId, dueDay: dayNumber, items: breakdown.items };
        run(() => (item ? updateFixedExpense(item.id, input) : createFixedExpense(input)));
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
      <div className="flex flex-col gap-1.5">
        <span id="fx-wallet" className="text-sm font-medium">{t("wallet")}</span>
        <div role="radiogroup" aria-labelledby="fx-wallet" className="flex flex-wrap gap-2">
          {usable.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={w.id === walletId}
              disabled={pending || (w.currency !== currency && (itemDrafts.length > 0 || (item?.items?.length ?? 0) > 0))}
              onClick={() => {
                setWalletId(w.id);
                if (w.currency !== currency) setAmount("");
              }}
              className="min-h-11 rounded-full border border-border bg-card px-4 text-sm font-medium aria-checked:border-2 aria-checked:border-foreground aria-checked:bg-accent"
            >
              <bdi>{w.name}</bdi> · {w.currency}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-muted-foreground">{t("walletHelp")}</p>
        {itemDrafts.length > 0 || (item?.items?.length ?? 0) > 0 ? <p className="text-[13px] text-muted-foreground">{tb("removeBeforeCurrencyChange")}</p> : null}
      </div>
      <TextField
        label={t("amount")}
        description={tCurrencies("reenterAmount", { currency })}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode={CURRENCY_DECIMALS[currency] === 0 ? "numeric" : "decimal"}
        placeholder="0"
        autoComplete="off"
        dir="ltr"
        error={amountError}
      />
      <CategorySelect
        categories={expenseCategories}
        value={categoryId}
        onChange={setCategoryId}
        label={t("category")}
        placeholder={tAdd("categoryPlaceholder")}
      />
      <div className="flex flex-col gap-1">
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
        <p className="text-[13px] text-muted-foreground">{t("dueHelp")}</p>
      </div>

      <ExpenseBreakdownFields currency={currency} parentMinor={minor} items={itemDrafts}
        onChange={setItemDrafts} labels={breakdownLabels} disabled={pending} />

      {error ? (
        <p role="alert" className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">{error}</p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={pending || !canSave}>
        {item ? t("saveChanges") : t("save")}
      </Button>

      {item ? (
        confirmDelete ? (
          <div className="flex flex-col gap-2 rounded-xl border border-border p-3.5">
            <p className="text-[15px]">{t("deleteConfirm")}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
                {t("cancel")}
              </Button>
              <Button type="button" variant="destructive" disabled={pending} onClick={() => run(() => deleteFixedExpense(item.id))}>
                {t("delete")}
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="ghost" className="text-over" onClick={() => setConfirmDelete(true)}>
            {t("delete")}
          </Button>
        )
      ) : null}
    </form>
  );
}

/** New items can be a monthly expense or an installment; editing keeps the monthly form. */
function Body({ item, onClose }: { item: FixedExpense | null; onClose: () => void }) {
  const t = useTranslations("Installments");
  const [kind, setKind] = useState<"monthly" | "installment">("monthly");
  if (item) return <Form item={item} onClose={onClose} />;
  return (
    <div className="flex flex-col gap-4">
      <Segmented
        label={t("kind")}
        value={kind}
        onChange={setKind}
        options={[
          { value: "monthly", label: t("monthly") },
          { value: "installment", label: t("installment") },
        ]}
      />
      {kind === "monthly" ? <Form item={null} onClose={onClose} /> : <InstallmentForm item={null} onClose={onClose} />}
    </div>
  );
}

export function FixedSheet({ state, onClose }: { state: FixedSheetState | null; onClose: () => void }) {
  const t = useTranslations("Fixed");
  return (
    <SheetShell
      open={state !== null}
      onOpenChange={(o) => !o && onClose()}
      title={state?.item ? t("editTitle") : t("newTitle")}
    >
      {state ? <Body key={state.item?.id ?? "new"} item={state.item} onClose={onClose} /> : null}
    </SheetShell>
  );
}
