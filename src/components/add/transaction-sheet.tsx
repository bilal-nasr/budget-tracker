"use client";

import { useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { ChevronDown, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AmountKeypad } from "@/components/add/amount-keypad";
import { ExpenseBreakdownFields, useExpenseBreakdownLabels } from "./expense-breakdown-fields";
import { CashSettlementFields, parseSettlementDraft, settlementDraftFromSnapshot } from "./cash-settlement-fields";
import { useCashSettlementLabels } from "./cash-settlement-labels";
import { useAppData } from "@/components/providers/app-data";
import { CategorySelect } from "@/components/categories/category-select";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField, numericInputClassName, numericInputProps } from "@/components/ui/text-field";
import { WalletSelect } from "@/components/wallets/wallet-select";
import { useRouter } from "@/i18n/navigation";
import { addDays, todayIn } from "@/features/transactions/group";
import {
  createTransaction,
  createTransfer,
  deleteTransaction,
  updateTransaction,
} from "@/features/transactions/actions";
import type { Transaction, TransactionInput } from "@/features/transactions/schema";
import { parseExpenseItemDrafts, type ExpenseItemDraft } from "@/features/transactions/breakdown";
import { categoryOptions } from "@/features/categories/catalogue";
import { CURRENCY_DECIMALS, convertAtRate, currencyPrefix, groupTyped, parseAmount, parseRate, supportsUsdLbpRate, toInputText, type Currency } from "@/lib/money";
import { cn } from "@/lib/utils";

type Mode = "expense" | "income" | "move";

/** Where the sheet was opened from. `walletId` is a wallet the user is adding money to. */
export type ComposerPreset = { kind?: Mode; walletId?: string; categoryId?: string };

export type ComposerState =
  | { mode: "add"; draftId: string; initial?: Transaction; preset?: ComposerPreset }
  | { mode: "edit"; initial: Transaction };

const LAST_WALLET_KEY = "lastWalletId";

/** "54." is a valid half-typed amount; parseAmount wants digits after the dot. */
const parseTyped = (typed: string, currency: Currency) =>
  typed === "" ? null : parseAmount(typed.endsWith(".") ? typed.slice(0, -1) : typed, currency);

const chipClass =
  "min-h-11 rounded-full border border-border bg-card px-4 text-sm font-medium aria-checked:border-2 aria-checked:border-foreground aria-checked:bg-accent";

function Form({ state, onClose, onCreateWallet, onReload }: { state: ComposerState; onClose: () => void; onCreateWallet?: () => void; onReload: () => void }) {
  const t = useTranslations("Add");
  const tc = useTranslations("Categories");
  const tb = useTranslations("Breakdown");
  const breakdownLabels = useExpenseBreakdownLabels();
  const ts = useTranslations("Cashier");
  const settlementLabels = useCashSettlementLabels();
  const tCurrencies = useTranslations("Currencies");
  const router = useRouter();
  const { wallets, categories, timezone, walletById, usdLbpRate } = useAppData();
  const [pending, startTransition] = useTransition();
  const initial = state.initial;
  const preset = state.mode === "add" ? state.preset : undefined;
  // A wallet the user chose "Add money" on. New money goes in as income; Move takes it from another wallet.
  const topUpId = preset?.walletId;

  const usable = wallets.filter((w) => !w.archived || w.id === initial?.walletId);
  const [mode, setMode] = useState<Mode>(
    initial && (initial.kind === "expense" || initial.kind === "income") ? initial.kind : (preset?.kind ?? "expense"),
  );
  const [walletId, setWalletId] = useState(() => {
    if (initial) return initial.walletId;
    if (topUpId && usable.some((w) => w.id === topUpId)) return topUpId;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_WALLET_KEY);
    } catch {}
    return usable.find((w) => w.id === last)?.id ?? usable[0]?.id ?? "";
  });
  const [toWalletId, setToWalletId] = useState("");
  const wallet = walletById(walletId);
  const toWallet = walletById(toWalletId);
  const currency: Currency = wallet?.currency ?? "USD";
  const [cashDraft, setCashDraft] = useState(() => settlementDraftFromSnapshot(initial?.settlement ?? null, currency, walletId, state.mode === "add"));
  const settlementEligible = mode === "expense" && (state.mode === "add" || (!initial?.source && !initial?.installmentId));
  const exchange = mode === "move" && toWallet !== undefined && wallet !== undefined && toWallet.currency !== wallet.currency;
  const rateSupported = exchange && toWallet !== undefined && supportsUsdLbpRate(currency, toWallet.currency);

  const [typed, setTyped] = useState(initial ? toInputText(initial.amountMinor, initial.currency) : "");
  // Rate is LBP per 1 USD. Received follows amount × rate until the owner edits it.
  const [rateText, setRateText] = useState(usdLbpRate ? String(usdLbpRate) : "");
  const [receivedText, setReceivedText] = useState("");
  const [receivedEdited, setReceivedEdited] = useState(false);
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? preset?.categoryId ?? "");
  const [date, setDate] = useState(() => (state.mode === "edit" && initial ? initial.occurredOn : todayIn(timezone)));
  const [note, setNote] = useState(initial?.note ?? "");
  const [itemDrafts, setItemDrafts] = useState<ExpenseItemDraft[]>(() => (initial?.items ?? []).map((item) => ({
    key: crypto.randomUUID(), description: item.description, amountText: toInputText(item.amountMinor, initial!.currency),
  })));
  const [unresolved, setUnresolved] = useState(false);
  const attemptSnapshot = useRef<TransactionInput | null>(null);
  const inFlight = useRef(false);
  const [pickWallet, setPickWallet] = useState(false);
  const [details, setDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [reloading, setReloading] = useState(false);
  const noteInput = useRef<HTMLInputElement>(null);
  const receivedInput = useRef<HTMLInputElement>(null);

  const today = todayIn(timezone);
  const list = mode === "move" ? [] : categoryOptions(categories, mode, state.mode === "edit" ? initial?.categoryId ?? undefined : undefined);
  const categoryAvailable = list.some((c) => c.id === categoryId);
  const minor = parseTyped(typed, currency);
  const itemResult = parseExpenseItemDrafts(currency, minor, itemDrafts);
  const cashEditContext = state.mode === "edit" ? { walletId, original: state.initial } : undefined;
  const cashResult = parseSettlementDraft(cashDraft, currency, minor, wallets, cashEditContext);
  const currencyLocked = itemDrafts.length > 0 || (state.mode === "edit" && state.initial.items.length > 0);
  const rate = parseRate(rateText);
  const rateError = rateSupported && !receivedEdited && rateText.trim() !== "" && rate === null ? t("errorRate") : null;
  const converted =
    rateSupported && toWallet && minor !== null && rate !== null
      ? convertAtRate(minor, currency, toWallet.currency, rate)
      : null;
  const receivedValue = receivedEdited ? receivedText : converted === null ? "" : toInputText(converted, toWallet?.currency ?? "USD");
  const receivedMinor =
    !exchange || !toWallet ? minor : receivedValue.trim() === "" ? null : parseAmount(receivedValue, toWallet.currency);
  const tooSmall = exchange && !receivedEdited && converted === 0;
  const receivedError =
    exchange && receivedEdited && receivedText.trim() !== "" && receivedMinor === null
      ? t("errorAmount")
      : tooSmall
        ? t("errorTooSmall")
        : null;
  const canSave =
    minor !== null && minor > 0 && wallet !== undefined && date !== "" &&
    (mode === "move"
      ? toWallet !== undefined && toWalletId !== walletId && receivedMinor !== null && receivedMinor > 0
      : categoryAvailable && (mode === "expense" ? itemResult.valid && (!settlementEligible || cashResult.ok) : itemDrafts.length === 0));

  const dayLabel = date === today ? t("today") : date === addDays(today, -1) ? t("yesterday") : date;

  const otherWallets = usable.filter((w) => w.id !== walletId);
  const resetReceived = () => {
    setReceivedText("");
    setReceivedEdited(false);
  };
  const changeToWallet = (id: string) => {
    if (walletById(id)?.currency !== toWallet?.currency) resetReceived();
    setToWalletId(id);
  };
  const editReceived = () => {
    flushSync(() => {
      if (!receivedEdited) {
        setReceivedText(receivedValue);
        setReceivedEdited(true);
      }
    });
    receivedInput.current?.focus();
  };

  const changeMode = (next: Mode) => {
    if (next !== mode && cashDraft.enabled) { setError(ts("removeBeforeKindChange")); return; }
    if (next !== mode && itemDrafts.length > 0) { setError(tb("removeBeforeKindChange")); return; }
    if (state.mode === "edit" && initial?.source && next !== initial.kind) { setError(tb("sourceKindLocked")); return; }
    setMode(next);
    setCategoryId("");
    setError(null);
    setPickWallet(false);
    resetReceived();
    if (next === "move") {
      if (topUpId && walletId === topUpId) {
        // Adding money to a wallet: it is the destination, and the source is another wallet.
        const source = usable.find((w) => w.id !== topUpId);
        if (source) {
          setToWalletId(topUpId);
          setWalletId(source.id);
          if (source.currency !== currency) setTyped("");
        }
      } else if (!toWalletId || toWalletId === walletId) {
        setToWalletId(usable.find((w) => w.id !== walletId)?.id ?? "");
      }
    }
  };

  const changeWallet = (id: string) => {
    if (currencyLocked && walletById(id)?.currency !== currency) { setError(tb("removeBeforeCurrencyChange")); return; }
    setWalletId(id);
    setPickWallet(false);
    if (toWalletId === id) {
      setToWalletId("");
      resetReceived();
    }
    if (walletById(id)?.currency !== currency) {
      setTyped("");
      setCashDraft((previous) => ({ ...settlementDraftFromSnapshot(null, walletById(id)!.currency, id), enabled: previous.enabled }));
      resetReceived();
    }
  };

  const fail = (code: string) => {
    setConflicted(code === "conflict");
    setError(code === "notConfigured" ? t("errorPreview")
    : code === "categoryUnavailable" ? tc("errorUnavailable")
    : code === "conflict" ? tb("conflict")
    : code === "breakdownExceedsTotal" ? tb("exceedsTotal")
    : code === "breakdownCurrencyLocked" ? tb("removeBeforeCurrencyChange")
    : code === "settlementMismatch" ? ts("mismatch")
    : code === "unsupportedPair" ? ts("unsupportedPair")
    : code === "walletUnavailable" ? tb("walletUnavailable") : t("errorFailed"));
  };
  const reloadLatest = () => {
    setReloading(true);
    onReload();
  };
  const done = () => {
    try {
      localStorage.setItem(LAST_WALLET_KEY, walletId);
    } catch {}
    onClose();
  };
  const undoToast = (label: string, id: string, revision: number) =>
    toast(label, {
      action: {
        label: t("undo"),
        onClick: async () => {
          const undone = await deleteTransaction(id, revision);
          if (!undone.ok) {
            if (undone.error === "conflict") toast.error(tb("conflict"), {
              action: { label: tb("reload"), onClick: onReload },
            });
            else toast.error(t("errorFailed"));
          }
        },
      },
    });

  const save = () => {
    if (conflicted || reloading || (!canSave && !unresolved) || inFlight.current) return;
    setError(null);
    if (mode === "move") {
      if (receivedMinor === null || minor === null) return;
      inFlight.current = true;
      startTransition(async () => {
        try {
        const result = await createTransfer({
          occurredOn: date,
          fromWalletId: walletId,
          toWalletId,
          fromAmountMinor: minor,
          toAmountMinor: receivedMinor,
          rate: rateSupported && !receivedEdited && rate !== null ? rate : undefined,
          note: note.trim() || undefined,
        });
        if (!result.ok) return fail(result.error);
        const id = result.id;
        done();
        undoToast(t("moved"), id, result.revision);
        } catch { fail("failed"); } finally { inFlight.current = false; }
      });
      return;
    }
    const amountMinor = minor ?? attemptSnapshot.current?.amountMinor;
    if (amountMinor === undefined) return;
    const input: TransactionInput = attemptSnapshot.current ?? {
      kind: mode,
      occurredOn: date,
      walletId,
      amountMinor,
      categoryId,
      note: note.trim() || undefined,
      items: mode === "expense" && itemResult.valid ? itemResult.items : [],
      settlement: settlementEligible && cashResult.ok
        ? (cashDraft.enabled ? cashResult.settlement : initial?.settlement ? null : undefined)
        : initial?.settlement && !cashDraft.enabled ? null : undefined,
    };
    if (state.mode === "add") attemptSnapshot.current = input;
    inFlight.current = true;
    startTransition(async () => {
      try {
      if (state.mode === "edit") {
        const result = await updateTransaction(state.initial.id, input, state.initial.revision);
        if (!result.ok) return fail(result.error);
        done();
        toast(t("updated"));
        return;
      }
      const result = await createTransaction(input, state.draftId);
      if (!result.ok) {
        if (result.error === "failed") { setUnresolved(true); setError(tb("unknownOutcome")); }
        else { attemptSnapshot.current = null; setUnresolved(false); fail(result.error); }
        return;
      }
      const id = result.id;
      done();
      undoToast(t("saved"), id, result.revision);
      } catch {
        if (state.mode === "add") { setUnresolved(true); setError(tb("unknownOutcome")); }
        else fail("failed");
      } finally { inFlight.current = false; }
    });
  };

  if (usable.length === 0 && !unresolved) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <p className="max-w-[30ch] text-[15px] text-muted-foreground">{t("needWallet")}</p>
        <Button
          onClick={() => {
            onClose();
            router.push("/wallets");
          }}
        >
          {t("addWalletFirst")}
        </Button>
      </div>
    );
  }

  const modes: { value: Mode; label: string }[] =
    state.mode === "edit"
      ? [
          { value: "expense", label: t("expense") },
          { value: "income", label: t("income") },
        ]
      : [
          { value: "expense", label: t("expense") },
          { value: "income", label: t("income") },
          { value: "move", label: t("move") },
        ];

  return (
    <div className="flex flex-col">
      <fieldset disabled={pending || unresolved || reloading} className="contents">
      <Segmented label={t("kind")} value={mode} onChange={changeMode} options={modes} />

      {topUpId && mode !== "expense" && walletById(topUpId) ? (
        <p className="mt-2.5 rounded-lg bg-accent px-3.5 py-2.5 text-[13px] text-foreground">
          {mode === "move"
            ? t("topUpMove", { wallet: walletById(topUpId)?.name ?? "" })
            : t("topUpNew", { wallet: walletById(topUpId)?.name ?? "" })}
        </p>
      ) : null}

      {settlementEligible && cashDraft.enabled ? <p className="pt-3 text-sm text-muted-foreground">{ts("cost")}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 py-3.5">
        <p
          className={cn(
            "amount flex min-w-0 items-baseline gap-1 leading-none font-bold tracking-tight",
            typed.length > 12 ? "text-xl" : "text-[40px]",
            typed === "" && "text-muted-foreground",
          )}
          aria-label={t("amount")}
        >
          <bdi dir="ltr" className="text-[28px] font-semibold text-muted-foreground">{currencyPrefix(currency)}</bdi>
          <bdi dir="ltr">{typed === "" ? "0" : groupTyped(typed)}</bdi>
        </p>
        {mode !== "move" ? <Button
          variant="outline"
          className="shrink-0 rounded-full"
          aria-expanded={pickWallet}
          onClick={() => setPickWallet((v) => !v)}
        >
          <span className="max-w-[9ch] truncate">
            <bdi>{wallet?.name}</bdi>
          </span>{" "}
          <span className="text-muted-foreground">{currency}</span>
          <ChevronDown aria-hidden className={cn("transition-transform", pickWallet && "rotate-180")} />
        </Button> : null}
      </div>

      {pickWallet && mode !== "move" ? (
        <div role="radiogroup" aria-label={t("wallet")} className="mb-3 flex flex-wrap gap-2">
          {usable.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={w.id === walletId}
              disabled={currencyLocked && w.currency !== currency}
              onClick={() => changeWallet(w.id)}
              className={chipClass}
            >
              <bdi>{w.name}</bdi> · {w.currency}
            </button>
          ))}
        </div>
      ) : null}

      {mode === "move" ? (
        <div className="flex flex-col gap-3">
          {otherWallets.length === 0 ? (
            <p className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">{t("moveNeedTwo")}</p>
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3">
                <WalletSelect wallets={usable} value={walletId} onChange={changeWallet} label={t("from")} placeholder={t("chooseWallet")} />
                <WalletSelect wallets={otherWallets} value={toWalletId} onChange={changeToWallet} label={t("to")} placeholder={t("chooseWallet")} />
              </div>
              {exchange && toWallet ? (
                <div className="flex flex-col gap-3">
                  {rateSupported ? <div className="flex flex-col gap-1.5">
                    <label htmlFor="move-rate" className="text-sm font-medium">{t("rate")}</label>
                    <div dir="ltr" className="flex items-center gap-2">
                      <span className="shrink-0 text-base font-semibold">{t("rateUsd")}</span>
                      <input
                        id="move-rate"
                        value={rateText}
                        onChange={(e) => setRateText(e.target.value)}
                        inputMode="numeric"
                        placeholder="89500"
                        {...numericInputProps}
                        aria-invalid={rateError ? true : undefined}
                        className={`h-12 min-w-0 flex-1 rounded-lg border border-input bg-card px-3.5 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-over ${numericInputClassName}`}
                      />
                      <span className="shrink-0 text-base text-muted-foreground">{t("rateLbp")}</span>
                    </div>
                    {rateError ? <p role="alert" className="text-sm text-over">{rateError}</p> : null}
                  </div> : null}
                  <div className="flex flex-col gap-1">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                    <TextField
                      ref={receivedInput}
                      label={t("received", { currency: toWallet.currency })}
                      value={receivedValue}
                      readOnly={!receivedEdited}
                      onChange={(e) => {
                        if (receivedEdited) setReceivedText(e.target.value);
                      }}
                      inputMode={CURRENCY_DECIMALS[toWallet.currency] === 0 ? "numeric" : "decimal"}
                      placeholder="0"
                      autoComplete="off"
                      dir="ltr"
                      error={receivedError}
                      description={receivedEdited ? t(rateSupported ? "receivedManualHelp" : "receivedActualHelp") : t(converted === null ? "receivedNoRateHelp" : "receivedLockedHelp")}
                    />
                    <Button type="button" variant="outline" size="icon" className="mt-[1.625rem] size-12" aria-label={t("editReceived")} onClick={editReceived}>
                      <Pencil aria-hidden />
                    </Button>
                    </div>
                    {receivedEdited && rateSupported ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="self-start"
                        onClick={resetReceived}
                      >
                        {t("useRate")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <TextField
            label={t("name")}
            ref={noteInput}
            value={note}
            maxLength={140}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("namePlaceholder")}
            enterKeyHint="done"
            autoComplete="off"
          />
          <CategorySelect
            categories={list}
            value={categoryId}
            onChange={setCategoryId}
            label={t("category")}
            placeholder={t("categoryPlaceholder")}
            invalid={categoryId !== "" && !categoryAvailable}
          />
          {categoryId !== "" && !categoryAvailable ? <p role="alert" className="text-sm">{tc("errorUnavailable")}</p> : null}
          {mode === "expense" ? <ExpenseBreakdownFields currency={currency} parentMinor={minor}
            items={itemDrafts} onChange={setItemDrafts} labels={breakdownLabels} disabled={pending || unresolved} /> : null}
          {settlementEligible ? <>
            <CashSettlementFields draft={cashDraft} payCurrency={currency} costMinor={minor} wallets={wallets}
              editContext={cashEditContext}
              labels={settlementLabels} onChange={setCashDraft} onCreateWallet={() => onCreateWallet?.()} disabled={pending || unresolved} />
            {cashDraft.enabled && cashDraft.changeCurrency !== currency ? <p className="text-[13px] text-muted-foreground">{ts("crossChangeHelp")}</p> : null}
          </> : null}
          {currencyLocked ? <p className="text-[13px] text-muted-foreground">{tb("removeBeforeCurrencyChange")}</p> : null}
        </div>
      )}
      {typed === "" ? <p className="text-[13px] text-muted-foreground">{tCurrencies("reenterAmount", { currency })}</p> : null}

      <button
        type="button"
        aria-expanded={details}
        onClick={() => setDetails((v) => !v)}
        className="mt-1.5 flex min-h-12 items-center justify-between text-start text-sm text-muted-foreground"
      >
        <span>
          {mode === "move" ? (note ? `${dayLabel} · ${note}` : `${dayLabel} · ${t("addNote")}`) : dayLabel}
        </span>
        <ChevronDown aria-hidden className={cn("size-4 transition-transform", details && "rotate-180")} />
      </button>

      {details ? (
        <div className="mb-2 flex flex-col gap-3">
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
          {mode === "move" ? (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t("note")}
            <input
              ref={noteInput}
              type="text"
              value={note}
              maxLength={140}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              enterKeyHint="done"
              className="h-12 rounded-lg border border-input bg-card px-3.5 text-base font-normal"
            />
          </label>
          ) : null}
        </div>
      ) : null}

      <AmountKeypad
        className="mt-1"
        value={typed}
        currency={currency}
        onChange={setTyped}
        backspaceLabel={t("backspace")}
        textLabel={t("text")}
        onText={() => {
          if (mode === "move") setDetails(true);
          // Wait for the field to render, then focus it so the phone keyboard opens.
          requestAnimationFrame(() => {
            noteInput.current?.focus();
            noteInput.current?.scrollIntoView({ block: "center" });
          });
        }}
      />

      </fieldset>
      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">
          {error}
        </p>
      ) : null}

      <div className="sr-only" aria-live="polite">{canSave ? "" : t("incomplete")}</div>
      {conflicted ? <div className="mt-3 flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">{tb("reloadHint")}</p>
        <Button type="button" variant="outline" disabled={reloading || pending} onClick={reloadLatest}>
          {tb("reload")}
        </Button>
      </div> : null}
      <SaveBar
        disabled={(!canSave && !unresolved) || pending || conflicted || reloading}
        label={unresolved ? tb("retrySave") : state.mode === "edit" ? t("saveChanges") : mode === "move" ? t("moveSave") : t("save")}
        onSave={save}
      />
    </div>
  );
}

/** Sticks to the bottom of the sheet's scroll area so Save is always reachable. */
function SaveBar({ disabled, label, onSave }: { disabled: boolean; label: string; onSave: () => void }) {
  return (
    <div className="sticky -mx-4 bottom-0 mt-3 border-t border-border bg-card px-4 pt-2.5 pb-[calc(0.75rem+var(--safe-bottom))]">
      <Button variant="action" size="lg" className="w-full" disabled={disabled} onClick={onSave}>
        {label}
      </Button>
    </div>
  );
}

export function TransactionSheet({
  state,
  onClose,
  onCreateWallet,
  onReload = () => window.location.reload(),
}: {
  state: ComposerState | null;
  onClose: () => void;
  onCreateWallet?: () => void;
  /** A full new page drops stale client-held snapshots after explicit consent. */
  onReload?: () => void;
}) {
  const t = useTranslations("Add");
  return (
    <SheetShell
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={state?.mode === "edit" ? t("editTitle") : t("title")}
    >
      {state ? (
        <Form key={state.mode === "add" ? state.draftId : state.initial.id} state={state} onClose={onClose} onCreateWallet={onCreateWallet} onReload={onReload} />
      ) : null}
    </SheetShell>
  );
}
