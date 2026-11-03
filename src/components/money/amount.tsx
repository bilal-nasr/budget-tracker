"use client";

import { formatAmount, type Currency, type Digits } from "@/lib/money";
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
  currency: Currency;
  /** Overrides the profile's digit setting. */
  digits?: Digits;
  sign?: boolean;
  className?: string;
}) {
  const prefs = useDisplayPrefs();
  return (
    <bdi dir="ltr" className={cn("amount", className)}>
      {formatAmount(minor, currency, { digits: digits ?? prefs.digits, sign })}
    </bdi>
  );
}
