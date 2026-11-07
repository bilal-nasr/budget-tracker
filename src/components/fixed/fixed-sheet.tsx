"use client";
import { useRouter } from "@/i18n/navigation";
import { currencyIntent } from "@/lib/currency-intent";

import { BalancePicker } from "@/components/add/balance-picker";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRuntimeBalances, useMoneyDraftUnit } from "@/components/add/runtime-balances";
import { CategorySelect } from "@/components/categories/category-select";
import { categoryOptions } from "@/features/categories/catalogue";
import { InstallmentForm } from "@/components/installments/installment-sheet";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { createFixedExpense, deleteFixedExpense, updateFixedExpense } from "@/features/fixed/actions";
import type { FixedExpense } from "@/features/fixed/schema";
import { parseAmount, toInputText } from "@/lib/money";
import { parseOptionalDay } from "@/lib/numeric-text";
import { ExpenseBreakdownFields, useExpenseBreakdownLabels } from "@/components/add/expense-breakdown-fields";
import { parseExpenseItemDrafts, type ExpenseItemDraft } from "@/features/transactions/breakdown";

export type FixedSheetState = { item: FixedExpense | null };

function Form({ item, onClose }: { item: FixedExpense | null; onClose: () => void }) {
  const router = useRouter();
  const t = useTranslations("Fixed");
  const tBalance = useTranslations("Add");
  const currencyLabel = tBalance("walletCurrency");
  const tCurrencies = useTranslations("Currencies");
  const tc = useTranslations("Categories");
  const tAdd = useTranslations("Add");
  const tb = useTranslations("Breakdown");
  const breakdownLabels = useExpenseBreakdownLabels();
  const { balanceChoices: wallets, categories, balanceChoiceById, definition, walletContainers, enabledCurrencies, defaultBalanceId } = useRuntimeBalances();
  const [pending, startTransition] = useTransition();
  const usable = wallets.filter((w) => !w.archived || w.id === item?.balanceId);
  const expenseCategories = categoryOptions(categories, "expense", item?.categoryId);

  const [name, setName] = useState(item?.name ?? "");
  const [balanceId, setBalanceId] = useState(item?.balanceId ?? (usable.find((balance) => balance.id === defaultBalanceId) ?? usable[0])?.id ?? "");
  const balance = balanceChoiceById(balanceId);
  const currency = balance?.currency ?? enabledCurrencies[0]?.code ?? "";
  const [amount, setAmount] = useState(item && balance ? toInputText(item.amountMinor, definition(balance.currency)) : "");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "");
  const [dueDay, setDueDay] = useState(item?.dueDay ? String(item.dueDay) : "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemDrafts, setItemDrafts] = useState<ExpenseItemDraft[]>(() => (item?.items ?? []).map((line, index) => ({
    key: `fixed-${index}`, description: line.description, amountText: toInputText(line.amountMinor, definition(currency)),
  })));

  useMoneyDraftUnit(balance?.definition, () => { setAmount(""); setItemDrafts([]); }, balance !== undefined && !balance.archived);
  const minor = amount.trim() === "" ? null : parseAmount(amount, definition(currency));
  const amountError = amount.trim() !== "" && minor === null ? t("errorAmount") : null;
  const { value: dayNumber, invalid: invalidDay } = parseOptionalDay(dueDay);
  const dayError = invalidDay ? t("errorDay") : null;
  const breakdown = parseExpenseItemDrafts(definition(currency), minor, itemDrafts);
  const canSave =
    name.trim() !== "" && minor !== null && minor > 0 && balance !== undefined && !balance.archived && expenseCategories.some((c) => c.id === categoryId) && !dayError && breakdown.valid;

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        if (result.error === "conflict") { setAmount(""); setItemDrafts([]); router.refresh(); }
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
        const input = { expectedUnits: currencyIntent(definition(currency)), name: name.trim(), amountMinor: minor, balanceId: balanceId, categoryId, dueDay: dayNumber, items: breakdown.items };
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
<BalancePicker currencyLabel={currencyLabel} label={t("wallet")} wallets={walletContainers} currencies={enabledCurrencies} value={balanceId} onChange={(id) => {
            if (balanceChoiceById(id)?.currency !== currency) {
              if (itemDrafts.length || item?.items?.length) { setError(tb("removeBeforeCurrencyChange")); return; }
              setAmount("");
            }
            setBalanceId(id);
          }} />
        <p className="text-[13px] text-muted-foreground">{t("walletHelp")}</p>
        {itemDrafts.length > 0 || (item?.items?.length ?? 0) > 0 ? <p className="text-[13px] text-muted-foreground">{tb("removeBeforeCurrencyChange")}</p> : null}
      </div>
      <TextField
        label={t("amount")}
        description={tCurrencies("reenterAmount", { currency })}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode={definition(currency).decimalPlaces === 0 ? "numeric" : "decimal"}
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

      <ExpenseBreakdownFields currency={definition(currency)} parentMinor={minor} items={itemDrafts}
        onChange={setItemDrafts} labels={breakdownLabels} disabled={pending} />

      {error ? (
        <p role="alert" className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">{error}</p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" loading={pending} disabled={!canSave}>
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
              <Button type="button" variant="destructive" loading={pending} onClick={() => run(() => deleteFixedExpense(item.id))}>
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
