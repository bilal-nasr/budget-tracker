"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useAppData } from "@/components/providers/app-data";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { clearSalary, saveSalary } from "@/features/salary/actions";
import { CURRENCY_DECIMALS, parseAmount, toInputText } from "@/lib/money";

function Form({ onClose }: { onClose: () => void }) {
  const t = useTranslations("Salary");
  const tCurrencies = useTranslations("Currencies");
  const { legacyWallets: wallets, salary, legacyWalletById } = useAppData();
  const [pending, startTransition] = useTransition();
  const usable = wallets.filter((w) => !w.archived);
  const [walletId, setWalletId] = useState(() => {
    if (salary && usable.some((w) => w.id === salary.walletId)) return salary.walletId;
    return usable[0]?.id ?? "";
  });
  const wallet = legacyWalletById(walletId);
  const currency = wallet?.currency ?? "USD";
  const [amount, setAmount] = useState(
    salary && wallet?.id === salary.walletId ? toInputText(salary.amountMinor, wallet.currency) : "",
  );
  const [error, setError] = useState<string | null>(null);

  const minor = amount.trim() === "" ? null : parseAmount(amount, currency);
  const amountError = amount.trim() !== "" && minor === null ? t("errorAmount") : null;
  const canSave = minor !== null && minor > 0 && wallet !== undefined;

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
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
        if (canSave && minor !== null) run(() => saveSalary({ amountMinor: minor, walletId }));
      }}
    >
      <TextField
        label={t("amount")}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode={CURRENCY_DECIMALS[currency] === 0 ? "numeric" : "decimal"}
        placeholder="0"
        autoComplete="off"
        dir="ltr"
        error={amountError}
      />
      <div className="flex flex-col gap-1.5">
        <span id="salary-wallet" className="text-sm font-medium">{t("wallet")}</span>
        <div role="radiogroup" aria-labelledby="salary-wallet" className="flex flex-wrap gap-2">
          {usable.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={w.id === walletId}
              onClick={() => {
                if (w.currency !== currency) setAmount("");
                setWalletId(w.id);
              }}
              className="min-h-11 rounded-full border border-border bg-card px-4 text-sm font-medium aria-checked:border-2 aria-checked:border-foreground aria-checked:bg-accent"
            >
              <bdi>{w.name}</bdi> · {w.currency}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-muted-foreground">{t("walletHelp")}</p>
        <p className="text-[13px] text-muted-foreground">{tCurrencies("reenterAmount", { currency })}</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">{error}</p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={pending || !canSave}>
        {t("save")}
      </Button>
      {salary ? (
        <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => clearSalary())}>
          {t("remove")}
        </Button>
      ) : null}
    </form>
  );
}

export function SalarySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("Salary");
  const { salary } = useAppData();
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
