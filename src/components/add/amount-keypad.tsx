"use client";

import { Delete } from "lucide-react";
import { CURRENCY_DECIMALS, type Currency } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Applies one key press to the typed amount string. Pure, so it is easy to test. */
export function applyKey(value: string, key: string, currency: Currency): string {
  const decimals = CURRENCY_DECIMALS[currency];
  if (key === "back") return value.slice(0, -1);
  if (key === ".") {
    if (decimals === 0 || value.includes(".")) return value;
    return value === "" ? "0." : `${value}.`;
  }
  const next = key === "000" ? (value === "" ? "" : `${value}000`) : `${value === "0" ? "" : value}${key}`;
  const [whole, fraction = ""] = next.split(".");
  if (fraction.length > decimals || whole.length > 13) return value;
  return next;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * In-sheet keypad for touch devices. Keys are 56px tall, laid out left-to-right
 * in every language (numbers never mirror). Whole-unit currencies get "000".
 */
export function AmountKeypad({
  value,
  currency,
  onChange,
  backspaceLabel,
  onText,
  textLabel,
  className,
}: {
  value: string;
  currency: Currency;
  onChange: (next: string) => void;
  backspaceLabel: string;
  /** When set, a tall "Aa" key is shown that opens free-text entry (a custom label). */
  onText?: () => void;
  textLabel?: string;
  className?: string;
}) {
  const press = (key: string) => onChange(applyKey(value, key, currency));
  const keyClass =
    "grid h-14 [@media(max-height:700px)]:h-12 place-items-center rounded-lg bg-secondary text-2xl font-semibold text-foreground transition-colors active:bg-accent focus-visible:outline-2";
  return (
    <div dir="ltr" className={cn("grid gap-1.5", onText ? "grid-cols-4" : "grid-cols-3", className)}>
      {KEYS.map((key) => (
        <button key={key} type="button" className={keyClass} onClick={() => press(key)}>
          {key}
        </button>
      ))}
      <button
        type="button"
        className={cn(keyClass, "text-2xl font-semibold text-foreground")}
        onClick={() => press(CURRENCY_DECIMALS[currency] === 0 ? "000" : ".")}
      >
        {CURRENCY_DECIMALS[currency] === 0 ? "000" : "."}
      </button>
      <button type="button" className={keyClass} onClick={() => press("0")}>
        0
      </button>
      <button
        type="button"
        aria-label={backspaceLabel}
        className={cn(keyClass, "text-muted-foreground")}
        onClick={() => press("back")}
      >
        <Delete aria-hidden className="size-6" />
      </button>
      {onText ? (
        <button
          type="button"
          aria-label={textLabel}
          onClick={onText}
          className={cn(keyClass, "col-start-4 row-start-1 row-span-4 h-auto flex-col gap-1 bg-accent text-primary")}
        >
          <span aria-hidden>Aa</span>
          <span aria-hidden className="text-[11px] font-medium text-muted-foreground">{textLabel}</span>
        </button>
      ) : null}
    </div>
  );
}
