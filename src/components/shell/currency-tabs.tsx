"use client";

import type { CurrencyDefinition } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * Currency pill tabs for the teal shell header. Shared by Home and Wallets so
 * switching currency looks and behaves the same everywhere.
 */
export function CurrencyTabs({ currencies, value, onChange, label, className }: {
  currencies: readonly CurrencyDefinition[];
  value: string | null;
  onChange: (code: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]", className)}>
      {currencies.map((c) => (
        <button key={c.code} type="button" role="tab" aria-selected={c.code === value} onClick={() => onChange(c.code)}
          className={cn("min-h-11 shrink-0 rounded-full px-4 text-[15px] focus-visible:outline-2 focus-visible:outline-ring",
            c.code === value ? "bg-shell-foreground/15 font-semibold text-shell-foreground" : "text-shell-muted")}>
          <bdi dir="ltr">{c.code}</bdi>
        </button>
      ))}
    </div>
  );
}
