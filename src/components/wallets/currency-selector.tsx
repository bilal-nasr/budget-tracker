"use client";

import { useId } from "react";
import type { CurrencyDefinition } from "@/lib/currency";

/** One catalog-ordered choice; native select keeps long catalogs usable on small screens. */
export function CurrencySelector({ currencies, value, onChange, label, disabled }: {
  currencies: readonly CurrencyDefinition[];
  value: string;
  onChange: (code: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const id = useId();
  const enabled = currencies.filter((currency) => !currency.disabled);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <select id={id} dir="ltr" value={value} disabled={disabled || enabled.length === 0}
        onChange={(event) => { if (enabled.some((currency) => currency.code === event.target.value)) onChange(event.target.value); }}
        className="h-14 w-full min-w-0 max-w-full rounded-lg border border-input bg-background px-4 text-lg font-semibold focus-visible:ring-2 focus-visible:ring-ring">
        {enabled.map((currency) => <option key={currency.code} value={currency.code}>{currency.code}</option>)}
      </select>
    </div>
  );
}
