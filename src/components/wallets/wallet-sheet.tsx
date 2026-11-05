"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useAppDataOptional } from "@/components/providers/app-data";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { archiveWallet, createWallet, deleteWallet, unarchiveWallet, updateWallet } from "@/features/wallets/actions";
import type { Wallet, WalletKind } from "@/features/wallets/schema";
import { CURRENCIES, CURRENCY_DECIMALS, parseAmount, toInputText, type Currency } from "@/lib/money";

export type WalletSheetState = { wallet: Wallet | null };

export function WalletForm({
  wallet,
  onDone,
  submitLabel,
  onAddMoney,
}: {
  wallet: Wallet | null;
  onDone: () => void;
  submitLabel?: string;
  /** Edit mode only: opens the Add sheet to put money into this wallet. */
  onAddMoney?: (wallet: Wallet) => void;
}) {
  const t = useTranslations("Wallets");
  const tCurrencies = useTranslations("Currencies");
  const app = useAppDataOptional();
  const sources = (app?.legacyWallets ?? []).filter((w) => !w.archived);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(wallet?.name ?? "");
  const [kind, setKind] = useState<WalletKind>(wallet?.kind ?? "cash");
  const [currency, setCurrency] = useState<Currency>(wallet?.currency ?? "USD");
  const [owe, setOwe] = useState((wallet?.openingBalanceMinor ?? 0) < 0);
  const [amount, setAmount] = useState(
    wallet ? toInputText(wallet.openingBalanceMinor, wallet.currency) : "",
  );
  // Create mode only: is the starting balance new money, or taken from another wallet?
  const [fromWallet, setFromWallet] = useState(false);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [takenText, setTakenText] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = amount.trim() === "" ? 0 : parseAmount(amount, currency);
  const nameOk = name.trim().length > 0;
  const amountError = parsedAmount === null ? t("errorAmount") : null;
  const source = sources.find((s) => s.id === sourceId);
  const canFund = !wallet && !owe && parsedAmount !== null && parsedAmount > 0 && sources.length > 0;
  const funding = canFund && fromWallet;
  const sameCurrency = source !== undefined && source.currency === currency;
  const takenMinor = !funding || !source ? null : sameCurrency ? parsedAmount : takenText.trim() === "" ? null : parseAmount(takenText, source.currency);
  const takenError = funding && !sameCurrency && takenText.trim() !== "" && takenMinor === null ? t("errorAmount") : null;
  const fundingReady = !funding || (source !== undefined && takenMinor !== null && takenMinor > 0);

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
              : result.error === "inUse"
                ? t("errorInUse")
                : t("errorFailed"),
        );
        return;
      }
      onDone();
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!nameOk || parsedAmount === null || !fundingReady) return;
    const input = {
      name: name.trim(),
      kind,
      currency,
      openingBalanceMinor: owe ? -parsedAmount : parsedAmount,
    };
    run(() =>
      wallet
        ? updateWallet(wallet.id, input)
        : funding && source && takenMinor !== null
          ? createWallet(input, { fromWalletId: source.id, takenMinor })
          : createWallet(input),
    );
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
        {wallet ? <p className="min-h-11 py-2.5 font-semibold"><bdi dir="ltr">{currency}</bdi></p> : <Segmented
          label={t("currency")}
          value={currency}
          onChange={(next) => {
            if (next !== currency) {
              setAmount("");
              setTakenText("");
            }
            setCurrency(next);
          }}
          options={CURRENCIES.map((value) => ({ value, label: <bdi dir="ltr">{value}</bdi> }))}
        />}
        {wallet ? <p className="text-[13px] text-muted-foreground">{t("currencyLocked")}</p> : null}
        {!wallet ? <p className="text-[13px] text-muted-foreground">{tCurrencies("reenterAmount", { currency })}</p> : null}
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
        inputMode={CURRENCY_DECIMALS[currency] === 0 ? "numeric" : "decimal"}
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

      {canFund ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border p-3.5">
          <span id="w-source" className="text-sm font-medium">{t("sourceTitle")}</span>
          <Segmented
            label={t("sourceTitle")}
            value={fromWallet ? "wallet" : "new"}
            onChange={(next) => setFromWallet(next === "wallet")}
            options={[
              { value: "new", label: t("sourceNew") },
              { value: "wallet", label: t("sourceWallet") },
            ]}
          />
          {fromWallet ? (
            <>
              <div role="radiogroup" aria-label={t("sourcePick")} className="flex flex-wrap gap-2">
                {sources.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={s.id === sourceId}
                    onClick={() => {
                      if (source?.currency !== s.currency) setTakenText("");
                      setSourceId(s.id);
                    }}
                    className="min-h-11 rounded-full border border-border bg-card px-4 text-sm font-medium aria-checked:border-2 aria-checked:border-foreground aria-checked:bg-accent"
                  >
                    <bdi>{s.name}</bdi> · {s.currency}
                  </button>
                ))}
              </div>
              {source && !sameCurrency ? (
                <div className="flex flex-col gap-1">
                  <TextField
                    label={t("takenFrom", { currency: source.currency })}
                    value={takenText}
                    onChange={(e) => setTakenText(e.target.value)}
                    inputMode={CURRENCY_DECIMALS[source.currency] === 0 ? "numeric" : "decimal"}
                    placeholder="0"
                    autoComplete="off"
                    dir="ltr"
                    error={takenError}
                  />
                  <p className="text-[13px] text-muted-foreground">{t("takenHelp")}</p>
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">{t("takenSame")}</p>
              )}
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">{t("newMoneyHelp")}</p>
          )}
        </div>
      ) : null}

      <Button type="submit" size="lg" disabled={pending || !nameOk || parsedAmount === null || !fundingReady} className="w-full">
        {submitLabel ?? (wallet ? t("saveChanges") : t("create"))}
      </Button>

      {wallet && !wallet.archived && onAddMoney ? (
        <Button type="button" variant="outline" onClick={() => onAddMoney(wallet)}>
          {t("addMoney")}
        </Button>
      ) : null}

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
  onAddMoney,
}: {
  state: WalletSheetState | null;
  onClose: () => void;
  onAddMoney?: (wallet: Wallet) => void;
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
      {state ? <WalletForm key={state.wallet?.id ?? "new"} wallet={state.wallet} onDone={onClose} onAddMoney={onAddMoney} /> : null}
    </SheetShell>
  );
}
