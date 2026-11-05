"use client";

import { formatAmount, isCurrency, type CurrencyDefinition, type Digits } from "@/lib/money";
import { useAppDataOptional } from "@/components/providers/app-data";
import { cn } from "@/lib/utils";
import { useDisplayPrefs } from "@/components/providers/display-prefs";

/** An amount is always LTR, tabular and isolated, in every language. */
export function Amount({
  minor,
  currency,
  digits,
  sign,
  className,
}: {
  minor: number;
  currency: string | CurrencyDefinition;
  /** Overrides the profile's digit setting. */
  digits?: Digits;
  sign?: boolean;
  className?: string;
}) {
  const prefs = useDisplayPrefs();
  const app = useAppDataOptional();
  const definition = typeof currency === "string" ? app?.currencyByCode(currency) : currency;
  if (app && !definition) throw new Error("App currency data unavailable");
  const options = { digits: digits ?? prefs.digits, sign };
  let formatted: string;
  if (definition) formatted = formatAmount(minor, definition, options);
  else if (typeof currency === "string" && isCurrency(currency)) formatted = formatAmount(minor, currency, options);
  else throw new Error("App currency data unavailable");
  return (
    <bdi dir="ltr" className={cn("amount", className)}>
      {formatted}
    </bdi>
  );
}
