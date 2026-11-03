"use client";

import { useRef, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AmountKeypad } from "@/components/add/amount-keypad";
import { useAppData } from "@/components/providers/app-data";
import { CategoryGlyph } from "@/components/tiles/tile-glyph";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SheetShell } from "@/components/ui/sheet-shell";
import { useRouter } from "@/i18n/navigation";
import { categoryName } from "@/features/categories/schema";
import { addDays, todayIn } from "@/features/transactions/group";
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from "@/features/transactions/actions";
import type { Transaction, TxnKind } from "@/features/transactions/schema";
import { groupTyped, parseAmount, toInputText, type Currency } from "@/lib/money";
import { cn } from "@/lib/utils";

export type ComposerState =
  | { mode: "add"; initial?: Transaction }
  | { mode: "edit"; initial: Transaction };

const LAST_WALLET_KEY = "lastWalletId";
const VISIBLE_CATEGORIES = 7;

/** "54." is a valid half-typed amount; parseAmount wants digits after the dot. */
const parseTyped = (typed: string, currency: Currency) =>
  typed === "" ? null : parseAmount(typed.endsWith(".") ? typed.slice(0, -1) : typed, currency);

function Form({
  state,
  onClose,
}: {
  state: ComposerState;
  onClose: () => void;
}) {
  const t = useTranslations("Add");
  const locale = useLocale();
  const router = useRouter();
  const { wallets, categories, timezone, walletById } = useAppData();
  const [pending, startTransition] = useTransition();
  const initial = state.initial;

  const usable = wallets.filter((w) => !w.archived || w.id === initial?.walletId);
  const [kind, setKind] = useState<TxnKind>(initial?.kind ?? "expense");
  const [walletId, setWalletId] = useState(() => {
    if (initial) return initial.walletId;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_WALLET_KEY);
    } catch {}
    return usable.find((w) => w.id === last)?.id ?? usable[0]?.id ?? "";
  });
  const wallet = walletById(walletId);
  const currency: Currency = wallet?.currency ?? "USD";
  const [typed, setTyped] = useState(initial ? toInputText(initial.amountMinor, initial.currency) : "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [date, setDate] = useState(() => (state.mode === "edit" && initial ? initial.occurredOn : todayIn(timezone)));
  const [note, setNote] = useState(initial?.note ?? "");
  const [pickWallet, setPickWallet] = useState(false);
  const [details, setDetails] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteInput = useRef<HTMLInputElement>(null);

  const today = todayIn(timezone);
  const list = categories.filter((c) => c.kind === kind);
  const crowded = list.length > VISIBLE_CATEGORIES + 1;
  const shown = showAll || !crowded ? list : list.slice(0, VISIBLE_CATEGORIES);
  const minor = parseTyped(typed, currency);
  const canSave = minor !== null && minor > 0 && wallet !== undefined && categoryId !== "" && date !== "";

  const dayLabel = date === today ? t("today") : date === addDays(today, -1) ? t("yesterday") : date;

  const changeKind = (next: TxnKind) => {
    setKind(next);
    setCategoryId("");
    setShowAll(false);
  };

  const changeWallet = (id: string) => {
    setWalletId(id);
    setPickWallet(false);
    // LBP has no decimals.
    if (walletById(id)?.currency === "LBP") setTyped((v) => v.split(".")[0]);
  };

  const save = () => {
    if (!canSave || minor === null) return;
    setError(null);
    const input = {
      kind,
      occurredOn: date,
      walletId,
      amountMinor: minor,
      categoryId,
      note: note.trim() || undefined,
    };
    const fail = (code: string) => setError(code === "notConfigured" ? t("errorPreview") : t("errorFailed"));
    const done = () => {
      try {
        localStorage.setItem(LAST_WALLET_KEY, walletId);
      } catch {}
      onClose();
      router.refresh();
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
      toast(t("saved"), {
        action: {
          label: t("undo"),
          onClick: async () => {
            await deleteTransaction(id);
            router.refresh();
          },
        },
      });
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

  return (
    <div className="flex flex-col">
      <Segmented
        label={t("kind")}
        value={kind}
        onChange={changeKind}
        options={[
          { value: "expense", label: t("expense") },
          { value: "income", label: t("income") },
        ]}
      />

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
          onClick={() => setPickWallet((v) => !v)}
        >
          <span className="max-w-[9ch] truncate">
            <bdi>{wallet?.name}</bdi>
          </span>
          <span className="text-muted-foreground">{currency}</span>
          <ChevronDown aria-hidden className={cn("transition-transform", pickWallet && "rotate-180")} />
        </Button>
      </div>

      {pickWallet ? (
        <div role="radiogroup" aria-label={t("wallet")} className="mb-3 flex flex-wrap gap-2">
          {usable.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={w.id === walletId}
              onClick={() => changeWallet(w.id)}
              className="min-h-11 rounded-full border border-border bg-card px-4 text-sm font-medium aria-checked:border-2 aria-checked:border-foreground aria-checked:bg-accent"
            >
              <bdi>{w.name}</bdi> · {w.currency}
            </button>
          ))}
        </div>
      ) : null}

      <div role="radiogroup" aria-label={t("category")} className="grid grid-cols-4 gap-2">
        {shown.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={c.id === categoryId}
            onClick={() => setCategoryId(c.id)}
            className="flex min-h-[78px] [@media(max-height:700px)]:min-h-[66px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-0.5 py-1.5 text-xs font-medium aria-checked:border-2 aria-checked:border-foreground aria-checked:bg-accent"
          >
            <CategoryGlyph tile={c.tile} color={c.color} />
            <span className="max-w-full truncate px-1">
              <bdi>{categoryName(c, locale)}</bdi>
            </span>
          </button>
        ))}
        {crowded && !showAll ? (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="flex min-h-[78px] items-center justify-center rounded-xl border border-dashed border-input bg-card text-xs font-medium"
          >
            {t("more")}
          </button>
        ) : null}
      </div>

      <button
        type="button"
        aria-expanded={details}
        onClick={() => setDetails((v) => !v)}
        className="mt-1.5 flex min-h-12 items-center justify-between text-start text-sm text-muted-foreground"
      >
        <span>
          {dayLabel}
          {note ? ` · ${note}` : ` · ${t("addNote")}`}
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
          setDetails(true);
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
      <SaveBar disabled={!canSave || pending} label={state.mode === "edit" ? t("saveChanges") : t("save")} onSave={save} />
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
      {state ? <Form key={state.mode + (state.initial?.id ?? "new")} state={state} onClose={onClose} /> : null}
    </SheetShell>
  );
}

