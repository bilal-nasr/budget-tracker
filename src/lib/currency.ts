export type CurrencyDefinition = {
  code: string;
  symbol: string;
  decimalPlaces: number;
  disabled: boolean;
  firstUsed: boolean;
};

export const SEED_CURRENCY_DEFINITIONS: readonly CurrencyDefinition[] = Object.freeze([
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

export const MAX_MINOR = 1_000_000_000_000_000;
/** Whole LBP per USD reference quote limit. */
export const MAX_RATE = 10_000_000;

/** The profile reference quote supports only these two directed pairs. */
export function supportsUsdLbpRate(from: string, to: string): boolean {
  return (from === "USD" && to === "LBP") || (from === "LBP" && to === "USD");
}
