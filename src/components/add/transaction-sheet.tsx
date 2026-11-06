"use client";

import { currencyIntent } from "@/lib/currency-intent";
import { useEffect, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { ChevronDown, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AmountKeypad } from "@/components/add/amount-keypad";
import { ExpenseBreakdownFields, useExpenseBreakdownLabels } from "./expense-breakdown-fields";
import { CashSettlementFields, parseSettlementDraft, settlementDraftFromSnapshot, type CashSettlementDraft } from "./cash-settlement-fields";
import { useCashSettlementLabels } from "./cash-settlement-labels";
import { useAppData } from "@/components/providers/app-data";
import { CategorySelect } from "@/components/categories/category-select";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField, numericInputClassName, numericInputProps } from "@/components/ui/text-field";
import { BalancePicker } from "./balance-picker";
import { useRouter } from "@/i18n/navigation";
import { addDays, todayIn } from "@/features/transactions/group";
import {
  createTransaction,
  createTransfer,
  deleteTransaction,
  updateTransaction,
} from "@/features/transactions/actions";
import { convertTransferAtRate } from "@/features/transactions/transfer-amounts";
import { classifyBalanceTransfer, type Transaction, type TransactionInput, type TransferInput } from "@/features/transactions/schema";
import { parseExpenseItemDrafts, type ExpenseItemDraft } from "@/features/transactions/breakdown";
import { categoryOptions } from "@/features/categories/catalogue";
import { groupTyped, parseAmount, parseRate, supportsUsdLbpRate, toInputText } from "@/lib/money";
import { cn } from "@/lib/utils";

type Mode = "expense" | "income" | "move" | "exchange";
type ExpenseStyle = "standard" | "cashPurchase";

/** Where the sheet was opened from. `walletId` is a wallet the user is adding money to. */
export type ComposerPreset = { kind?: Mode; walletId?: string; categoryId?: string };

/**
 * Everything typed into an unsaved Add form. Kept in memory when the sheet is
 * dismissed by accident (swipe down, backdrop tap) and offered back on reopen.
 */
export type DraftSnapshot = {
  mode: Mode; balanceId: string; toBalanceId: string; purchaseCurrency: string;
  cashDraft: CashSettlementDraft; typed: string; rateText: string; receivedText: string;
  receivedEdited: boolean; categoryId: string; date: string; note: string;
  itemDrafts: ExpenseItemDraft[]; details: boolean;
};

export type ComposerState =
  | { mode: "add"; draftId: string; initial?: Transaction; preset?: ComposerPreset; restore?: DraftSnapshot }
  | { mode: "edit"; initial: Transaction };

const LAST_WALLET_KEY = "lastWalletId";

/** "54." is a valid half-typed amount; parseAmount wants digits after the dot. */
const parseTyped = (typed: string, currency: import("@/lib/currency").CurrencyDefinition) =>
  typed === "" ? null : parseAmount(typed.endsWith(".") ? typed.slice(0, -1) : typed, currency);

function Form({ state, onClose, onReload, onStash, onStartOver }: {
  state: ComposerState; onClose: () => void; onCreateWallet?: () => void; onReload: () => void;
  onStash?: (draft: DraftSnapshot) => void; onStartOver?: () => void;
}) {
  const t = useTranslations("Add");
  const tc = useTranslations("Categories");
  const tb = useTranslations("Breakdown");
  const breakdownLabels = useExpenseBreakdownLabels();
  const ts = useTranslations("Cashier");
  const settlementLabels = useCashSettlementLabels();
  const tCurrencies = useTranslations("Currencies");
  const router = useRouter();
  const app = useAppData();
  const { walletContainers, enabledCurrencies, categories, timezone, usdLbpRate } = app;
  // Presentation choices retain exact balance IDs and runtime currency codes.
  const wallets = walletContainers.flatMap((container) => container.balances.map((balance) => ({
    id: balance.id, name: container.name, kind: container.kind, currency: balance.currency,
    balanceMinor: balance.balanceMinor, openingBalanceMinor: balance.openingBalanceMinor,
    position: container.position, archived: container.deleted,
  })));
  const balanceOptionById = (id: string) => wallets.find((wallet) => wallet.id === id);
  const defaultId = (id?: string) => id ? app.walletById(id)?.defaultBalanceId ?? (app.balanceById(id) ? id : undefined) : undefined;
  const definition = (code: string) => { const found = app.currencyByCode(code); if (!found) throw new Error("App currency data unavailable"); return found; };
  const [pending, startTransition] = useTransition();
  const initial = state.initial;
  const preset = state.mode === "add" ? state.preset : undefined;
  // A wallet the user chose "Add money" on. New money goes in as income; Move takes it from another wallet.
  const topUpId = defaultId(preset?.walletId);
  // An unsaved entry the sheet was dismissed on; every field below starts from it.
  const saved = state.mode === "add" ? state.restore : undefined;

  const usable = wallets.filter((w) => !w.archived || w.id === initial?.balanceId);
  const [mode, setMode] = useState<Mode>(
    saved?.mode ?? (initial && (initial.kind === "expense" || initial.kind === "income") ? initial.kind : (preset?.kind ?? "expense")),
  );
  const [balanceId, setBalanceId] = useState(() => {
    if (saved) return saved.balanceId;
    if (initial) return initial.balanceId;
    if (topUpId && usable.some((w) => w.id === topUpId)) return topUpId;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_WALLET_KEY);
    } catch {}
    const remembered = defaultId(last ?? undefined);
    return usable.find((w) => w.id === remembered)?.id ?? defaultId(walletContainers[0]?.id) ?? "";
  });
  const [toBalanceId, setToBalanceId] = useState(saved?.toBalanceId ?? "");
  const transferring = mode === "move" || mode === "exchange";
  const balance = balanceOptionById(balanceId);
  const toWallet = balanceOptionById(toBalanceId);
  const currency = balance?.currency ?? app.balanceById(balanceId)?.currency ?? enabledCurrencies[0]?.code ?? "";
  const [purchaseCurrency, setPurchaseCurrency] = useState<string>(saved?.purchaseCurrency ?? initial?.currency ?? currency);
  const [cashDraft, setCashDraft] = useState(() => saved?.cashDraft ?? settlementDraftFromSnapshot(initial?.settlement ?? null, currency, balanceId, state.mode === "add", app.currencies));
  const settlementEligible = mode === "expense" && (state.mode === "add" || (!initial?.source && !initial?.installmentId));
  const crossCurrency = transferring && toWallet !== undefined && balance !== undefined && toWallet.currency !== balance.currency;
  const rateSupported = crossCurrency && toWallet !== undefined && supportsUsdLbpRate(currency, toWallet.currency);

  const [typed, setTyped] = useState(saved?.typed ?? (initial ? toInputText(initial.amountMinor, definition(initial.currency)) : ""));
  // Rate is LBP per 1 USD. Received follows amount × rate until the owner edits it.
  const [rateText, setRateText] = useState(saved?.rateText ?? (usdLbpRate ? String(usdLbpRate) : ""));
  const [receivedText, setReceivedText] = useState(saved?.receivedText ?? "");
  const [receivedEdited, setReceivedEdited] = useState(saved?.receivedEdited ?? false);
  const [categoryId, setCategoryId] = useState(saved?.categoryId ?? initial?.categoryId ?? preset?.categoryId ?? "");
  const [date, setDate] = useState(() => saved?.date ?? (state.mode === "edit" && initial ? initial.occurredOn : todayIn(timezone)));
  const [note, setNote] = useState(saved?.note ?? initial?.note ?? "");
  const [itemDrafts, setItemDrafts] = useState<ExpenseItemDraft[]>(() => saved?.itemDrafts ?? (initial?.items ?? []).map((item) => ({
    key: crypto.randomUUID(), description: item.description, amountText: toInputText(item.amountMinor, definition(initial!.currency)),
  })));
  const [unresolved, setUnresolved] = useState(false);
  const attemptSnapshot = useRef<TransactionInput | null>(null);
  const transferAttempt = useRef<TransferInput | null>(null);
  const inFlight = useRef(false);
  const [pickWallet, setPickWallet] = useState(false);
  const [details, setDetails] = useState(saved?.details ?? false);
  const [error, setError] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [reloading, setReloading] = useState(false);
  const noteInput = useRef<HTMLInputElement>(null);
  const receivedInput = useRef<HTMLInputElement>(null);

  // Keep the unsaved entry when the sheet is dismissed by accident. Saving, Start over and
  // an attempt whose outcome is unknown never stash: those must not come back.
  const finished = useRef(false);
  const stashable = useRef<{ draft: DraftSnapshot; keep: boolean; onStash?: (draft: DraftSnapshot) => void } | null>(null);
  useEffect(() => {
    stashable.current = {
      onStash,
      draft: { mode, balanceId, toBalanceId, purchaseCurrency, cashDraft, typed, rateText, receivedText, receivedEdited, categoryId, date, note, itemDrafts, details },
      keep: state.mode === "add" && !state.initial && !unresolved &&
        (typed !== "" || note.trim() !== "" || itemDrafts.length > 0 || cashDraft.enabled || toBalanceId !== "" ||
          categoryId !== (preset?.categoryId ?? "")),
    };
  });
  useEffect(() => () => {
    const latest = stashable.current;
    if (finished.current || !latest?.keep || inFlight.current || attemptSnapshot.current || transferAttempt.current) return;
    latest.onStash?.(latest.draft);
  }, []);
  const startOver = () => {
    finished.current = true;
    onStartOver?.();
  };

  const today = todayIn(timezone);
  const list = transferring ? [] : categoryOptions(categories, mode as "expense" | "income", state.mode === "edit" ? initial?.categoryId ?? undefined : undefined);
  const categoryAvailable = list.some((c) => c.id === categoryId);
  const amountCurrency = mode === "expense" && cashDraft.enabled ? purchaseCurrency : currency;
  const amountDefinition = app.currencyByCode(amountCurrency);
  const payerDefinition = app.currencyByCode(currency);
  const sourceUnit = `${amountCurrency}:${amountDefinition?.decimalPlaces}:${amountDefinition?.disabled}:${balance !== undefined}`;
  const destinationUnit = toWallet ? `${toWallet.currency}:${definition(toWallet.currency).decimalPlaces}` : "";
  const [draftUnits, setDraftUnits] = useState({ source: sourceUnit, destination: destinationUnit });
  if (draftUnits.source !== sourceUnit || draftUnits.destination !== destinationUnit) {
    setDraftUnits({ source: sourceUnit, destination: destinationUnit });
    if (draftUnits.source !== sourceUnit) { setTyped(""); setItemDrafts([]); }
    setReceivedText("");
    setReceivedEdited(false);
  }
  const cashUnit = (code: string, balanceId: string) => `${code}:${app.currencyByCode(code)?.decimalPlaces}:${app.currencyByCode(code)?.disabled}:${balanceOptionById(balanceId)?.currency === code}`;
  const cashUnits = { tender: cashUnit(currency, balanceId), changes: Object.fromEntries(cashDraft.changes.map((change) => [change.key, cashUnit(change.currency, change.balanceId)])) };
  const [cashDraftUnits, setCashDraftUnits] = useState(cashUnits);
  if (JSON.stringify(cashDraftUnits) !== JSON.stringify(cashUnits)) {
    setCashDraftUnits(cashUnits);
    const invalidTender = cashDraftUnits.tender !== cashUnits.tender;
    const invalidChanges = new Set(cashDraft.changes.filter((change) => cashDraftUnits.changes[change.key] !== undefined && cashDraftUnits.changes[change.key] !== cashUnits.changes[change.key]).map((change) => change.key));
    if (invalidTender || invalidChanges.size) setCashDraft((draft) => ({ ...draft,
      tenderText: invalidTender ? "" : draft.tenderText,
      changes: draft.changes.map((change) => invalidChanges.has(change.key) ? { ...change, amountText: "", rate: undefined } : change),
    }));
  }
  const minor = amountDefinition ? parseTyped(typed, amountDefinition) : null;
  const cashTender = cashDraft.enabled ? (payerDefinition ? parseTyped(cashDraft.tenderText, payerDefinition) : null) : minor;
  const balanceExceeded = state.mode === "add" && mode === "expense" && balance !== undefined &&
    cashTender !== null && cashTender > 0 && cashTender > balance.balanceMinor;
  const itemResult = amountDefinition ? parseExpenseItemDrafts(amountDefinition, minor, itemDrafts) : { valid: false as const, items: [] };
  const cashEditContext = state.mode === "edit" ? { balanceId: balanceId, original: state.initial } : undefined;
  const cashResult = parseSettlementDraft(cashDraft, currency, purchaseCurrency, minor, wallets, cashEditContext, app.currencies);
  const currencyLocked = itemDrafts.length > 0 || (state.mode === "edit" && state.initial.items.length > 0);
  const rate = parseRate(rateText);
  const rateError = rateSupported && !receivedEdited && rateText.trim() !== "" && rate === null ? t("errorRate") : null;
  const converted =
    rateSupported && toWallet && minor !== null && rate !== null
      ? convertTransferAtRate(minor, definition(currency), definition(toWallet.currency), rate)
      : null;
  const receivedValue = receivedEdited ? receivedText : converted === null ? "" : toInputText(converted, definition(toWallet?.currency ?? "USD"));
  const receivedMinor =
    !crossCurrency || !toWallet ? minor : receivedValue.trim() === "" ? null : parseAmount(receivedValue, definition(toWallet.currency));
  const tooSmall = crossCurrency && !receivedEdited && converted === 0;
  const receivedError =
    crossCurrency && receivedEdited && receivedText.trim() !== "" && receivedMinor === null
      ? t("errorAmount")
      : tooSmall
        ? t("errorTooSmall")
        : null;
  const owner = app.balanceById(balanceId)?.walletId;
  const destinationContainers = walletContainers.map((container) => ({ ...container,
    balances: container.balances.filter((balance) => balance.id !== balanceId && (mode === "exchange" ? container.id === owner : container.id !== owner)),
  })).filter((container) => container.balances.length > 0);
  const otherWallets = usable.filter((w) => destinationContainers.some((container) => container.balances.some((balance) => balance.id === w.id)));
  const sourceBalance = app.balanceById(balanceId);
  const destinationBalance = app.balanceById(toBalanceId);
  const transferKind = sourceBalance && destinationBalance && sourceBalance.id !== destinationBalance.id
    ? classifyBalanceTransfer(sourceBalance, destinationBalance) : null;
  const canSave =
    minor !== null && minor > 0 && balance !== undefined && date !== "" &&
    (transferring
      ? transferKind === mode && toWallet !== undefined && otherWallets.some((item) => item.id === toBalanceId) && toBalanceId !== balanceId && receivedMinor !== null && receivedMinor > 0
      : categoryAvailable && (mode === "expense" ? itemResult.valid && (!settlementEligible || cashResult.ok) : itemDrafts.length === 0));

  const dayLabel = date === today ? t("today") : date === addDays(today, -1) ? t("yesterday") : date;

  const resetReceived = () => {
    setReceivedText("");
    setReceivedEdited(false);
  };
  const changeToWallet = (id: string) => {
    if (balanceOptionById(id)?.currency !== toWallet?.currency) resetReceived();
    setToBalanceId(id);
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
    if (next === "move" || next === "exchange") {
      if (next === "exchange") { setToBalanceId(app.walletById(app.balanceById(balanceId)?.walletId ?? "")?.balances.find((balance) => balance.id !== balanceId && !definition(balance.currency).disabled)?.id ?? ""); return; }
      if (topUpId && balanceId === topUpId) {
        // Adding money to a wallet: it is the destination, and the source is another wallet.
        const sourceContainer = walletContainers.find((container) => container.id !== app.balanceById(topUpId)?.walletId);
        const source = usable.find((balance) => balance.id === sourceContainer?.defaultBalanceId);
        if (source) {
          setToBalanceId(topUpId);
          setBalanceId(source.id);
          if (source.currency !== currency) setTyped("");
        }
      } else if (!toBalanceId || toBalanceId === balanceId || app.balanceById(toBalanceId)?.walletId === app.balanceById(balanceId)?.walletId) {
        setToBalanceId(walletContainers.find((container) => container.id !== app.balanceById(balanceId)?.walletId)?.defaultBalanceId ?? "");
      }
    }
  };

  const changeExpenseStyle = (next: ExpenseStyle) => {
    if (next === "cashPurchase") {
      setCashDraft((previous) => ({ ...previous, enabled: true }));
      setError(null);
      return;
    }
    if (purchaseCurrency !== currency) {
      setError(ts("alignBeforeStandard"));
      return;
    }
    setCashDraft((previous) => ({ ...previous, enabled: false }));
    setError(null);
  };

  const changeWallet = (id: string) => {
    if (currencyLocked && !cashDraft.enabled && balanceOptionById(id)?.currency !== currency) { setError(tb("removeBeforeCurrencyChange")); return; }
    setBalanceId(id);
    if (mode === "exchange") {
      const kept = app.balanceById(toBalanceId);
      if (!kept || kept.walletId !== app.balanceById(id)?.walletId || kept.id === id) {
        setToBalanceId(app.walletById(app.balanceById(id)?.walletId ?? "")?.balances.find((b) => b.id !== id && !b.detached && !definition(b.currency).disabled)?.id ?? "");
        resetReceived();
      }
    } else if (toBalanceId === id || (mode === "move" && app.balanceById(toBalanceId)?.walletId === app.balanceById(id)?.walletId)) {
      setToBalanceId("");
      resetReceived();
    }
    if (balanceOptionById(id)?.currency !== currency) {
      if (!cashDraft.enabled) { setTyped(""); setPurchaseCurrency(balanceOptionById(id)!.currency); }
      setCashDraft((previous) => ({ ...previous, tenderText: "" }));
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
      localStorage.setItem(LAST_WALLET_KEY, app.balanceById(balanceId)?.walletId ?? balanceId);
    } catch {}
    finished.current = true;
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
    if (transferring) {
      if (state.mode !== "add" || (!transferAttempt.current && (receivedMinor === null || minor === null))) return;
      const input = transferAttempt.current ?? {
        requestId: state.draftId, occurredOn: date,
        sourceBalanceId: balanceId, destinationBalanceId: toBalanceId,
        sentMinor: minor!, receivedMinor: receivedMinor!,
        expectedUnits: currencyIntent(payerDefinition, toWallet ? app.currencyByCode(toWallet.currency) : undefined),
        rate: rateSupported && !receivedEdited && rate !== null ? rate : undefined,
        note: note.trim() || undefined,
      };
      transferAttempt.current = input;
      inFlight.current = true;
      startTransition(async () => {
        try {
          const result = await createTransfer(input);
          if (!result.ok) {
            if (result.error === "failed") { setUnresolved(true); setError(tb("unknownOutcome")); }
            else { transferAttempt.current = null; setUnresolved(false); fail(result.error); }
            return;
          }
          done();
          undoToast(t(mode === "exchange" ? "exchanged" : "moved"), result.id, result.revision);
        } catch { setUnresolved(true); setError(tb("unknownOutcome")); }
        finally { inFlight.current = false; }
      });
      return;
    }
    const amountMinor = minor ?? attemptSnapshot.current?.amountMinor;
    if (amountMinor === undefined) return;
    const input: TransactionInput = attemptSnapshot.current ?? {
      expectedUnits: currencyIntent(amountDefinition, payerDefinition, ...(cashDraft.enabled ? cashDraft.changes.map((change) => app.currencyByCode(change.currency)) : [])),
      kind: mode as "expense" | "income",
      occurredOn: date,
      balanceId: balanceId,
      amountMinor,
      ...(settlementEligible ? { costCurrency: cashDraft.enabled ? purchaseCurrency : currency } : {}),
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
          { value: "exchange", label: t("exchange") },
        ];

  return (
    <div className="flex flex-col">
      <fieldset disabled={pending || unresolved || reloading} className="contents">
      {saved ? (
        <div className="mb-2.5 flex items-center justify-between gap-3 rounded-lg bg-accent ps-3.5 pe-1 text-[13px] text-foreground">
          <span>{t("draftRestored")}</span>
          <Button variant="ghost" size="sm" onClick={startOver}>{t("startOver")}</Button>
        </div>
      ) : null}
      <Segmented label={t("kind")} value={mode} onChange={changeMode} options={modes} />

      {settlementEligible ? <Segmented<ExpenseStyle>
        label={ts("paymentStyle")}
        value={cashDraft.enabled ? "cashPurchase" : "standard"}
        onChange={changeExpenseStyle}
        options={[
          { value: "standard", label: ts("standard") },
          { value: "cashPurchase", label: ts("cashPurchase") },
        ]}
        className="mt-2"
      /> : null}

      {topUpId && mode !== "expense" && balanceOptionById(topUpId) ? (
        <p className="mt-2.5 rounded-lg bg-accent px-3.5 py-2.5 text-[13px] text-foreground">
          {transferring
            ? t("topUpMove", { wallet: balanceOptionById(topUpId)?.name ?? "" })
            : t("topUpNew", { wallet: balanceOptionById(topUpId)?.name ?? "" })}
        </p>
      ) : null}

      {settlementEligible && cashDraft.enabled ? <>
        <label className="mt-3 flex flex-col gap-1.5 text-sm font-medium">
          {ts("purchaseCurrency")}
          <select aria-label={ts("purchaseCurrency")} value={purchaseCurrency}
            onChange={(event) => {
              const next = event.target.value as string;
              if (next !== purchaseCurrency) { setPurchaseCurrency(next); setTyped(""); }
            }}
            disabled={currencyLocked}
            className="h-12 rounded-lg border border-input bg-card px-3 text-base">
            {!amountDefinition ? <option value={purchaseCurrency}>{purchaseCurrency}</option> : null}
            {enabledCurrencies.map((currency) => currency.code).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <p className="pt-3 text-sm text-muted-foreground">{ts("cost")}</p>
      </> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 py-3.5 max-md:pointer-events-none max-md:sticky max-md:top-0 max-md:z-10 max-md:-mx-4 max-md:border-b max-md:border-border max-md:bg-card max-md:px-4">
        <p
          className={cn(
            "amount flex min-w-0 items-baseline gap-1 leading-none font-bold tracking-tight",
            typed.length > 12 ? "text-xl" : "text-[40px]",
            typed === "" && "text-muted-foreground",
          )}
          aria-label={t("amount")}
        >
          <bdi dir="ltr" className="text-[28px] font-semibold text-muted-foreground">{amountDefinition?.symbol ?? amountCurrency}</bdi>
          <bdi dir="ltr">{typed === "" ? "0" : groupTyped(typed)}</bdi>
        </p>
        {!transferring && !cashDraft.enabled ? <div className="flex shrink-0 flex-col items-end gap-1">
          <Button
            variant="outline"
            className="rounded-full max-md:pointer-events-auto"
            aria-expanded={pickWallet}
            onClick={() => setPickWallet((v) => !v)}
          >
            <span className="max-w-[9ch] truncate">
              <bdi>{balance?.name}</bdi>
            </span>{" "}
            <span className="text-muted-foreground">{currency}</span>
            <ChevronDown aria-hidden className={cn("transition-transform", pickWallet && "rotate-180")} />
          </Button>
          {state.mode === "add" && balance ? <WalletBalance label={t("balance")} wallet={balance} /> : null}
        </div> : null}
      </div>

      {balanceExceeded ? (
        <p role="status" className="mb-3 rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">
          {t("balanceWarning")}
        </p>
      ) : null}

      {pickWallet && !transferring && !cashDraft.enabled ? (
        <div className="mb-3"><BalancePicker wallets={walletContainers} currencies={enabledCurrencies} value={balanceId} onChange={changeWallet} label={t("wallet")} currencyLabel={t("walletCurrency")} /></div>
      ) : null}

      {transferring ? (
        <div className="flex flex-col gap-3">
          {otherWallets.length === 0 ? (
            <p className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">{t(mode === "exchange" ? "exchangeNeedTwo" : "moveNeedTwo")}</p>
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <BalancePicker wallets={walletContainers} currencies={enabledCurrencies} value={balanceId} onChange={changeWallet} label={t("from")} currencyLabel={t("fromCurrency")} />
                  {state.mode === "add" && balance ? <WalletBalance label={t("balance")} wallet={balance} /> : null}
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <BalancePicker wallets={destinationContainers} currencies={enabledCurrencies} value={toBalanceId} onChange={changeToWallet} label={t("to")} currencyLabel={t("toCurrency")} />
                  {state.mode === "add" && toWallet ? <WalletBalance label={t("balance")} wallet={toWallet} /> : null}
                </div>
              </div>
              {crossCurrency && toWallet ? (
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
                      inputMode={definition(toWallet.currency).decimalPlaces === 0 ? "numeric" : "decimal"}
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
          {mode === "expense" && amountDefinition ? <ExpenseBreakdownFields currency={amountDefinition} parentMinor={minor}
            items={itemDrafts} onChange={setItemDrafts} labels={breakdownLabels} disabled={pending || unresolved} /> : null}
          {settlementEligible && cashDraft.enabled ? <>
            <CashSettlementFields containers={walletContainers} definitions={app.currencies} draft={cashDraft} payCurrency={currency} costCurrency={purchaseCurrency} costMinor={minor} wallets={wallets}
              payerBalanceId={balanceId} onPayerBalanceChange={changeWallet}
              payerBalance={state.mode === "add" && balance ? <WalletBalance label={t("balance")} wallet={balance} /> : null}
              editContext={cashEditContext}
              labels={settlementLabels} onChange={setCashDraft} disabled={pending || unresolved} />
            {cashDraft.enabled && cashDraft.changes.some((change) => change.currency !== currency)
              ? <p className="text-[13px] text-muted-foreground">{ts("crossChangeHelp")}</p> : null}
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
          {transferring ? (note ? `${dayLabel} · ${note}` : `${dayLabel} · ${t("addNote")}`) : dayLabel}
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
          {transferring ? (
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

      {amountDefinition ? <AmountKeypad
        className="mt-1"
        value={typed}
        currency={amountDefinition}
        onChange={setTyped}
        backspaceLabel={t("backspace")}
        textLabel={t("text")}
        onText={() => {
          if (transferring) setDetails(true);
          // Wait for the field to render, then focus it so the phone keyboard opens.
          requestAnimationFrame(() => {
            noteInput.current?.focus();
            noteInput.current?.scrollIntoView({ block: "center" });
          });
        }}
      /> : <p role="status">{tCurrencies("draftUnavailable")}</p>}

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
        label={unresolved ? tb("retrySave") : state.mode === "edit" ? t("saveChanges") : transferring ? t(mode === "exchange" ? "exchangeSave" : "moveSave") : t("save")}
        onSave={save}
      />
    </div>
  );
}

function WalletBalance({ label, wallet: balance }: { label: string; wallet: { balanceMinor: number; currency: string } }) {
  return (
    <p className="text-[13px] text-muted-foreground">
      <span>{label}</span> · <Amount minor={balance.balanceMinor} currency={balance.currency} />
    </p>
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
  onStash,
  onStartOver,
}: {
  state: ComposerState | null;
  onClose: () => void;
  onCreateWallet?: () => void;
  /** Receives the unsaved entry when the sheet is dismissed without saving. */
  onStash?: (draft: DraftSnapshot) => void;
  /** Drops a restored entry and reopens Add empty. */
  onStartOver?: () => void;
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
        <Form key={state.mode === "add" ? state.draftId : state.initial.id} state={state} onClose={onClose} onCreateWallet={onCreateWallet} onReload={onReload} onStash={onStash} onStartOver={onStartOver} />
      ) : null}
    </SheetShell>
  );
}
