/** Ledger units, independent of locale and any exchange-rate source. */
export const CURRENCIES = Object.freeze(["USD", "LBP", "SYP"] as const);
export type Currency = (typeof CURRENCIES)[number];

/** SYP uses the current/new pound, stored in qirsh. LBP keeps whole-lira units. */
export const CURRENCY_DECIMALS: Readonly<Record<Currency, 0 | 2>> = Object.freeze({
  USD: 2,
  LBP: 0,
  SYP: 2,
});

export const MAX_MINOR = 1_000_000_000_000_000;
/** Whole LBP per USD; this bound does not describe an SYP exchange rate. */
export const MAX_RATE = 10_000_000;

const PREFIXES: Readonly<Record<Currency, string>> = Object.freeze({
  USD: "$",
  LBP: "LBP",
  SYP: "SYP",
});

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && CURRENCIES.some((currency) => currency === value);
}

export function currencyPrefix(currency: Currency): string {
  if (!isCurrency(currency)) throw new RangeError("Unsupported currency");
  return PREFIXES[currency];
}

/** Each caller owns its independent accumulator; currencies are never combined. */
export function emptyCurrencyTotals(): Record<Currency, number> {
  return { USD: 0, LBP: 0, SYP: 0 };
}

/** The legacy reference rate supports only these two directed exchange pairs. */
export function supportsUsdLbpRate(from: Currency, to: Currency): boolean {
  return (from === "USD" && to === "LBP") || (from === "LBP" && to === "USD");
}
