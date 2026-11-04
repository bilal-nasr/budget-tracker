import { CURRENCY_DECIMALS, MAX_MINOR, type Currency } from "@/lib/money";
import { normalizeNumericDigits } from "@/lib/numeric-text";

const bounded = (value: number, min = 0) => Number.isSafeInteger(value) && value >= min && value <= MAX_MINOR;

/** Percentages are fixed-point basis points; grouping separators are deliberately invalid. */
export function parsePercentBps(input: string): number | null {
  const text = normalizeNumericDigits(input.trim()).replace(/٫/g, ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return bps <= 10000 ? bps : null;
}

export function calculateLoanFee(principalMinor: number, feeBps: number): { feeMinor: number; totalDueMinor: number } | null {
  if (!bounded(principalMinor, 1) || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) return null;
  const fee = (BigInt(principalMinor) * BigInt(feeBps) + BigInt(5000)) / BigInt(10000);
  const total = BigInt(principalMinor) + fee;
  return total <= BigInt(MAX_MINOR) ? { feeMinor: Number(fee), totalDueMinor: Number(total) } : null;
}

export function allocateRepayment(amountMinor: number, principalRemainingMinor: number, feeRemainingMinor: number): { principalMinor: number; feeMinor: number } | null {
  if (!bounded(amountMinor, 1) || !bounded(principalRemainingMinor) || !bounded(feeRemainingMinor)) return null;
  if (BigInt(amountMinor) > BigInt(principalRemainingMinor) + BigInt(feeRemainingMinor)) return null;
  const principalMinor = Math.min(amountMinor, principalRemainingMinor);
  return { principalMinor, feeMinor: amountMinor - principalMinor };
}

export function summarizeLoans(loans: readonly { direction: "borrowed" | "lent"; currency: Currency; remainingMinor: number; deletedAt: string | null }[]): Record<Currency, { owedMinor: number; receivableMinor: number }> | null {
  const totals = Object.fromEntries(Object.keys(CURRENCY_DECIMALS).map((c) => [c, { owedMinor: 0, receivableMinor: 0 }])) as Record<Currency, { owedMinor: number; receivableMinor: number }>;
  for (const loan of loans) {
    if (loan.deletedAt !== null) continue;
    if (!bounded(loan.remainingMinor) || !totals[loan.currency]) return null;
    const key = loan.direction === "borrowed" ? "owedMinor" : "receivableMinor";
    const total = BigInt(totals[loan.currency][key]) + BigInt(loan.remainingMinor);
    if (total > BigInt(MAX_MINOR)) return null;
    totals[loan.currency][key] = Number(total);
  }
  return totals;
}

/** Exact input text; no floating division while editing percentages. */
export function percentInput(bps: number): string {
  return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, "0")}`;
}
