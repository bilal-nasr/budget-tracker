export type CurrencyDefinition = {
  code: string;
  symbol: string;
  decimalPlaces: number;
  disabled: boolean;
  firstUsed: boolean;
};

export const DEFAULT_CURRENCIES: readonly CurrencyDefinition[] = Object.freeze([
  Object.freeze({ code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: false }),
  Object.freeze({ code: "LBP", symbol: "LBP", decimalPlaces: 0, disabled: false, firstUsed: false }),
  Object.freeze({ code: "SYP", symbol: "SYP", decimalPlaces: 0, disabled: false, firstUsed: false }),
]);

export function indexCurrencies(definitions: readonly CurrencyDefinition[]): ReadonlyMap<string, CurrencyDefinition> {
  const index = new Map<string, CurrencyDefinition>();
  for (const definition of definitions) {
    if (index.has(definition.code)) throw new RangeError(`Duplicate currency: ${definition.code}`);
    index.set(definition.code, definition);
  }
  return index;
}

/** Disabled definitions remain available for historical money. */
export function requireCurrency(code: string, definitions: readonly CurrencyDefinition[]): CurrencyDefinition {
  const definition = indexCurrencies(definitions).get(code);
  if (!definition) throw new RangeError(`Missing currency definition: ${code}`);
  return definition;
}

export function enabledCurrencies(definitions: readonly CurrencyDefinition[]): CurrencyDefinition[] {
  return definitions.filter((definition) => !definition.disabled);
}

/** Temporary built-in APIs for callers awaiting the runtime-catalog migration. */
/** Ledger units, independent of locale and any exchange-rate source. */
export const CURRENCIES = Object.freeze(["USD", "LBP", "SYP"] as const);
export type Currency = (typeof CURRENCIES)[number];

/** USD uses cents; LBP and SYP both use whole-pound ledger units. */
export const CURRENCY_DECIMALS: Readonly<Record<Currency, 0 | 2>> = Object.freeze({
  USD: 2,
  LBP: 0,
  SYP: 0,
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
