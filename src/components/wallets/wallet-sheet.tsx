"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { useRouter } from "@/i18n/navigation";
import { archiveWallet, createWallet, deleteWallet, unarchiveWallet, updateWallet } from "@/features/wallets/actions";
import type { Wallet, WalletKind } from "@/features/wallets/schema";
import { parseAmount, toInputText, type Currency } from "@/lib/money";

export type WalletSheetState = { wallet: Wallet | null };

export function WalletForm({
  wallet,
  onDone,
  submitLabel,
}: {
  wallet: Wallet | null;
  onDone: () => void;
  submitLabel?: string;
}) {
  const t = useTranslations("Wallets");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(wallet?.name ?? "");
  const [kind, setKind] = useState<WalletKind>(wallet?.kind ?? "cash");
  const [currency, setCurrency] = useState<Currency>(wallet?.currency ?? "USD");
  const [owe, setOwe] = useState((wallet?.openingBalanceMinor ?? 0) < 0);
  const [amount, setAmount] = useState(
    wallet ? toInputText(wallet.openingBalanceMinor, wallet.currency) : "",
  );
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = amount.trim() === "" ? 0 : parseAmount(amount, currency);
  const nameOk = name.trim().length > 0;
  const amountError = parsedAmount === null ? t("errorAmount") : null;

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(
          result.error === "notConfigured"
            ? t("errorPreview")
            : result.error === "hasTransactions"
              ? t("errorHasTransactions")
              : t("errorFailed"),
        );
        return;
      }
      onDone();
      router.refresh();
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!nameOk || parsedAmount === null) return;
    const input = {
      name: name.trim(),
      kind,
      currency,
      openingBalanceMinor: owe ? -parsedAmount : parsedAmount,
    };
    run(() => (wallet ? updateWallet(wallet.id, input) : createWallet(input)));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <TextField
        label={t("name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        placeholder={t("namePlaceholder")}
        autoComplete="off"
        required
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t("kind")}</span>
        <Segmented
          label={t("kind")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "cash", label: t("cash") },
            { value: "bank", label: t("bank") },
            { value: "card", label: t("card") },
          ]}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t("currency")}</span>
        <Segmented
          label={t("currency")}
          value={currency}
          onChange={(next) => {
            setCurrency(next);
            if (next === "LBP") setAmount((v) => v.split(".")[0]);
          }}
          options={[
            { value: "USD", label: "USD" },
            { value: "LBP", label: "LBP" },
          ]}
        />
        {wallet ? <p className="text-[13px] text-muted-foreground">{t("currencyLocked")}</p> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t("opening")}</span>
        <Segmented
          label={t("opening")}
          value={owe ? "owe" : "have"}
          onChange={(next) => setOwe(next === "owe")}
          options={[
            { value: "have", label: t("have") },
            { value: "owe", label: t("owe") },
          ]}
        />
      </div>
      <TextField
        label={t("amount")}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode={currency === "USD" ? "decimal" : "numeric"}
        placeholder="0"
        autoComplete="off"
        dir="ltr"
        error={amountError}
      />

      {error ? (
        <p role="alert" className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending || !nameOk || parsedAmount === null} className="w-full">
        {submitLabel ?? (wallet ? t("saveChanges") : t("create"))}
      </Button>

      {wallet?.archived ? (
        <>
          <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => unarchiveWallet(wallet.id))}>
            {t("restore")}
          </Button>
          {confirmDelete ? (
            <div className="flex flex-col gap-2 rounded-xl border border-border p-3.5">
              <p className="text-[15px]">{t("deleteConfirm")}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
                  {t("cancel")}
                </Button>
                <Button type="button" variant="destructive" disabled={pending} onClick={() => run(() => deleteWallet(wallet.id))}>
                  {t("deleteWallet")}
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="ghost" className="text-over" onClick={() => setConfirmDelete(true)}>
              {t("deleteWallet")}
            </Button>
          )}
        </>
      ) : wallet ? (
        confirmArchive ? (
          <div className="flex flex-col gap-2 rounded-xl border border-border p-3.5">
            <p className="text-[15px]">{t("archiveConfirm")}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmArchive(false)}>
                {t("cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() => run(() => archiveWallet(wallet.id))}
              >
                {t("archive")}
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="ghost" onClick={() => setConfirmArchive(true)}>
            {t("archive")}
          </Button>
        )
      ) : null}
    </form>
  );
}

export function WalletSheet({
  state,
  onClose,
}: {
  state: WalletSheetState | null;
  onClose: () => void;
}) {
  const t = useTranslations("Wallets");
  return (
    <SheetShell
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={state?.wallet ? t("editTitle") : t("newTitle")}
    >
      {state ? <WalletForm key={state.wallet?.id ?? "new"} wallet={state.wallet} onDone={onClose} /> : null}
    </SheetShell>
  );
}
