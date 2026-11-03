"use client";

import { useRef, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AmountKeypad } from "@/components/add/amount-keypad";
import { useAppData } from "@/components/providers/app-data";
import { CategorySelect } from "@/components/categories/category-select";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SheetShell } from "@/components/ui/sheet-shell";
import { TextField } from "@/components/ui/text-field";
import { useRouter } from "@/i18n/navigation";
import { addDays, todayIn } from "@/features/transactions/group";
import {
  createTransaction,
  createTransfer,
  deleteTransaction,
  updateTransaction,
} from "@/features/transactions/actions";
import type { Transaction } from "@/features/transactions/schema";
import { convertAtRate, groupTyped, parseAmount, parseRate, toInputText, type Currency } from "@/lib/money";
import { cn } from "@/lib/utils";

type Mode = "expense" | "income" | "move";

/** Where the sheet was opened from. `walletId` is a wallet the user is adding money to. */
export type ComposerPreset = { kind?: Mode; walletId?: string; categoryId?: string };

export type ComposerState =
  | { mode: "add"; initial?: Transaction; preset?: ComposerPreset }
  | { mode: "edit"; initial: Transaction };

const LAST_WALLET_KEY = "lastWalletId";

/** "54." is a valid half-typed amount; parseAmount wants digits after the dot. */
const parseTyped = (typed: string, currency: Currency) =>
  typed === "" ? null : parseAmount(typed.endsWith(".") ? typed.slice(0, -1) : typed, currency);

const chipClass =
  "min-h-11 rounded-full border border-border bg-card px-4 text-sm font-medium aria-checked:border-2 aria-checked:border-foreground aria-checked:bg-accent";

function Form({ state, onClose }: { state: ComposerState; onClose: () => void }) {
  const t = useTranslations("Add");
  const router = useRouter();
  const { wallets, categories, timezone, walletById, usdLbpRate } = useAppData();
  const [pending, startTransition] = useTransition();
  const initial = state.initial;
  const preset = state.mode === "add" ? state.preset : undefined;
  // A wallet the user chose "Add money" on. New money goes in as income; Move takes it from another wallet.
  const topUpId = preset?.walletId;

  const usable = wallets.filter((w) => !w.archived || w.id === initial?.walletId);
  const [mode, setMode] = useState<Mode>(
    initial && initial.kind !== "transfer" ? initial.kind : (preset?.kind ?? "expense"),
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
  const exchange = mode === "move" && toWallet !== undefined && wallet !== undefined && toWallet.currency !== wallet.currency;

  const [typed, setTyped] = useState(initial ? toInputText(initial.amountMinor, initial.currency) : "");
  // Rate is LBP per 1 USD. Received follows amount × rate until the owner edits it.
  const [rateText, setRateText] = useState(usdLbpRate ? String(usdLbpRate) : "");
  const [receivedText, setReceivedText] = useState("");
  const [receivedEdited, setReceivedEdited] = useState(false);
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? preset?.categoryId ?? "");
  const [date, setDate] = useState(() => (state.mode === "edit" && initial ? initial.occurredOn : todayIn(timezone)));
  const [note, setNote] = useState(initial?.note ?? "");
  const [pickWallet, setPickWallet] = useState(false);
  const [details, setDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteInput = useRef<HTMLInputElement>(null);

  const today = todayIn(timezone);
  const list = categories.filter((c) => c.kind === mode);
  const minor = parseTyped(typed, currency);
  const rate = parseRate(rateText);
  const rateError = exchange && rateText.trim() !== "" && rate === null ? t("errorRate") : null;
  const converted =
    exchange && toWallet && minor !== null && rate !== null
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
      : categoryId !== "");

  const dayLabel = date === today ? t("today") : date === addDays(today, -1) ? t("yesterday") : date;

  const otherWallets = usable.filter((w) => w.id !== walletId);

  const changeMode = (next: Mode) => {
    setMode(next);
    setCategoryId("");
    setError(null);
    if (next === "move") {
      if (topUpId && walletId === topUpId) {
        // Adding money to a wallet: it is the destination, and the source is another wallet.
        const source = usable.find((w) => w.id !== topUpId);
        if (source) {
          setToWalletId(topUpId);
          setWalletId(source.id);
          if (source.currency === "LBP") setTyped((v) => v.split(".")[0]);
        }
      } else if (!toWalletId || toWalletId === walletId) {
        setToWalletId(usable.find((w) => w.id !== walletId)?.id ?? "");
      }
    }
  };

  const changeWallet = (id: string) => {
    setWalletId(id);
    setPickWallet(false);
    if (toWalletId === id) setToWalletId(usable.find((w) => w.id !== id)?.id ?? "");
    // LBP has no decimals.
    if (walletById(id)?.currency === "LBP") setTyped((v) => v.split(".")[0]);
  };

  const fail = (code: string) => setError(code === "notConfigured" ? t("errorPreview") : t("errorFailed"));
  const done = () => {
    try {
      localStorage.setItem(LAST_WALLET_KEY, walletId);
    } catch {}
    onClose();
  };
  const undoToast = (label: string, id: string) =>
    toast(label, {
      action: {
        label: t("undo"),
        onClick: async () => {
          await deleteTransaction(id);
        },
      },
    });

  const save = () => {
    if (!canSave || minor === null) return;
    setError(null);
    if (mode === "move") {
      if (receivedMinor === null) return;
      startTransition(async () => {
        const result = await createTransfer({
          occurredOn: date,
          fromWalletId: walletId,
          toWalletId,
          fromAmountMinor: minor,
          toAmountMinor: receivedMinor,
          rate: exchange && !receivedEdited && rate !== null ? rate : undefined,
          note: note.trim() || undefined,
        });
        if (!result.ok) return fail(result.error);
        const id = result.id;
        done();
        undoToast(t("moved"), id);
      });
      return;
    }
    const input = {
      kind: mode,
      occurredOn: date,
      walletId,
      amountMinor: minor,
      categoryId,
      note: note.trim() || undefined,
    };
    startTransition(async () => {
      if (state.mode === "edit") {
        const result = await updateTransaction(state.initial.id, input);
        if (!result.ok) return fail(result.error);
        done();
        toast(t("updated"));
        return;
      }
      const result = await createTransaction(input);
      if (!result.ok) return fail(result.error);
      const id = result.id;
      done();
      undoToast(t("saved"), id);
    });
  };

  if (usable.length === 0) {
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
      <Segmented label={t("kind")} value={mode} onChange={changeMode} options={modes} />

      {topUpId && mode !== "expense" && walletById(topUpId) ? (
        <p className="mt-2.5 rounded-lg bg-accent px-3.5 py-2.5 text-[13px] text-foreground">
          {mode === "move"
            ? t("topUpMove", { wallet: walletById(topUpId)?.name ?? "" })
            : t("topUpNew", { wallet: walletById(topUpId)?.name ?? "" })}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3 py-3.5">
        <p
          className={cn(
            "amount flex min-w-0 items-baseline gap-1 text-[46px] leading-none font-bold tracking-tight",
            typed === "" && "text-muted-foreground",
          )}
          aria-label={t("amount")}
        >
          <span className="text-[28px] font-semibold text-muted-foreground">{currency === "USD" ? "$" : "LBP"}</span>
          <span className="truncate">{typed === "" ? "0" : groupTyped(typed)}</span>
        </p>
        <Button
          variant="outline"
          className="shrink-0 rounded-full"
          aria-expanded={pickWallet}
          aria-label={mode === "move" ? t("fromWallet", { wallet: wallet?.name ?? "" }) : undefined}
          onClick={() => setPickWallet((v) => !v)}
        >
          {mode === "move" ? <span className="text-muted-foreground">{t("from")}</span> : null}
          <span className="max-w-[9ch] truncate">
            <bdi>{wallet?.name}</bdi>
          </span>
          <span className="text-muted-foreground">{currency}</span>
          <ChevronDown aria-hidden className={cn("transition-transform", pickWallet && "rotate-180")} />
        </Button>
      </div>

      {pickWallet ? (
        <div role="radiogroup" aria-label={mode === "move" ? t("from") : t("wallet")} className="mb-3 flex flex-wrap gap-2">
          {usable.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={w.id === walletId}
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
              <div className="flex flex-col gap-1.5">
                <span id="move-to" className="text-sm font-medium">{t("to")}</span>
                <div role="radiogroup" aria-labelledby="move-to" className="flex flex-wrap gap-2">
                  {otherWallets.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      role="radio"
                      aria-checked={w.id === toWalletId}
                      onClick={() => setToWalletId(w.id)}
                      className={chipClass}
                    >
                      <bdi>{w.name}</bdi> · {w.currency}
                    </button>
                  ))}
                </div>
              </div>
              {exchange && toWallet ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="move-rate" className="text-sm font-medium">{t("rate")}</label>
                    <div dir="ltr" className="flex items-center gap-2">
                      <span className="shrink-0 text-base font-semibold">{t("rateUsd")}</span>
                      <input
                        id="move-rate"
                        value={rateText}
                        onChange={(e) => setRateText(e.target.value)}
                        inputMode="numeric"
                        placeholder="89500"
                        autoComplete="off"
                        aria-invalid={rateError ? true : undefined}
                        className="h-12 min-w-0 flex-1 rounded-lg border border-input bg-card px-3.5 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-over"
                      />
                      <span className="shrink-0 text-base text-muted-foreground">{t("rateLbp")}</span>
                    </div>
                    {rateError ? <p role="alert" className="text-sm text-over">{rateError}</p> : null}
                  </div>
                  <div className="flex flex-col gap-1">
                    <TextField
                      label={t("received", { currency: toWallet.currency })}
                      value={receivedValue}
                      onChange={(e) => {
                        setReceivedText(e.target.value);
                        setReceivedEdited(true);
                      }}
                      inputMode={toWallet.currency === "USD" ? "decimal" : "numeric"}
                      placeholder="0"
                      autoComplete="off"
                      dir="ltr"
                      error={receivedError}
                    />
                    {receivedEdited ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="self-start"
                        onClick={() => setReceivedEdited(false)}
                      >
                        {t("useRate")}
                      </Button>
                    ) : (
                      <p className="text-[13px] text-muted-foreground">{t("rateHelp")}</p>
                    )}
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
          />
        </div>
      )}

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

      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">
          {error}
        </p>
      ) : null}

      <div className="sr-only" aria-live="polite">{canSave ? "" : t("incomplete")}</div>
      <SaveBar
        disabled={!canSave || pending}
        label={state.mode === "edit" ? t("saveChanges") : mode === "move" ? t("moveSave") : t("save")}
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
}: {
  state: ComposerState | null;
  onClose: () => void;
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
        <Form key={state.mode + (state.initial?.id ?? "new") + (state.mode === "add" ? (state.preset?.walletId ?? "") + (state.preset?.kind ?? "") + (state.preset?.categoryId ?? "") : "")} state={state} onClose={onClose} />
      ) : null}
    </SheetShell>
  );
}
