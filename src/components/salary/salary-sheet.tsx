"use client";
import { useRouter } from "@/i18n/navigation";
import { currencyIntent } from "@/lib/currency-intent";

import { BalancePicker } from "@/components/add/balance-picker";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRuntimeBalances, useMoneyDraftUnit } from "@/components/add/runtime-balances";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { clearSalary, saveSalary } from "@/features/salary/actions";
import { parseAmount, toInputText } from "@/lib/money";

function Form({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const t = useTranslations("Salary");
  const tBalance = useTranslations("Add");
  const currencyLabel = tBalance("walletCurrency");
  const tCurrencies = useTranslations("Currencies");
  const { balanceChoices: wallets, salary, balanceChoiceById, definition, walletContainers, enabledCurrencies, defaultBalanceId } = useRuntimeBalances();
  const [pending, startTransition] = useTransition();
  const usable = wallets.filter((w) => !w.archived);
  const [balanceId, setBalanceId] = useState(() => {
    if (salary && usable.some((w) => w.id === salary.balanceId)) return salary.balanceId;
    return (usable.find((balance) => balance.id === defaultBalanceId) ?? usable[0])?.id ?? "";
  });
  const balance = balanceChoiceById(balanceId);
  const currency = balance?.currency ?? enabledCurrencies[0]?.code ?? "";
  const [amount, setAmount] = useState(
    salary && balance?.id === salary.balanceId ? toInputText(salary.amountMinor, definition(balance.currency)) : "",
  );
  const [error, setError] = useState<string | null>(null);

  useMoneyDraftUnit(balance?.definition, () => { setAmount(""); }, balance !== undefined && !balance.archived);
  const minor = amount.trim() === "" ? null : parseAmount(amount, definition(currency));
  const amountError = amount.trim() !== "" && minor === null ? t("errorAmount") : null;
  const canSave = minor !== null && minor > 0 && balance !== undefined && !balance.archived;

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        if (result.error === "conflict") { setAmount(""); router.refresh(); }
        setError(result.error === "notConfigured" ? t("errorPreview") : t("errorFailed"));
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
        if (canSave && minor !== null) run(() => saveSalary({ expectedUnits: currencyIntent(balance?.definition), amountMinor: minor, balanceId: balanceId }));
      }}
    >
      <TextField
        label={t("amount")}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode={definition(currency).decimalPlaces === 0 ? "numeric" : "decimal"}
        placeholder="0"
        autoComplete="off"
        dir="ltr"
        error={amountError}
      />
      <div className="flex flex-col gap-1.5">
<BalancePicker currencyLabel={currencyLabel} label={t("wallet")} wallets={walletContainers} currencies={enabledCurrencies} value={balanceId} onChange={(id) => {
            if (balanceChoiceById(id)?.currency !== currency) { setAmount(""); }
            setBalanceId(id);
          }} />
        <p className="text-[13px] text-muted-foreground">{t("walletHelp")}</p>
        <p className="text-[13px] text-muted-foreground">{tCurrencies("reenterAmount", { currency })}</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">{error}</p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" loading={pending} disabled={!canSave}>
        {t("save")}
      </Button>
      {salary ? (
        <Button type="button" variant="ghost" loading={pending} onClick={() => run(() => clearSalary())}>
          {t("remove")}
        </Button>
      ) : null}
    </form>
  );
}

export function SalarySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("Salary");
  const { salary } = useRuntimeBalances();
  return (
    <SheetShell
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={salary ? t("editTitle") : t("setTitle")}
      description={t("explain")}
    >
      {open ? <Form onClose={onClose} /> : null}
    </SheetShell>
  );
}
