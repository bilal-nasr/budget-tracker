import type { CurrencyDefinition } from "@/lib/currency";

/**
 * How to format a row's amount for this viewer. A shared row may be in a currency the viewer never enabled,
 * so an unknown code shows as itself; decimals always come from the row, never the viewer's catalog.
 */
export function rowDefinition(
  row: { currency: string; decimalPlaces: number },
  viewerCatalog: ReadonlyMap<string, CurrencyDefinition>,
): CurrencyDefinition {
  const known = viewerCatalog.get(row.currency);
  return {
    code: row.currency,
    symbol: known?.symbol ?? row.currency,
    decimalPlaces: row.decimalPlaces,
    disabled: known?.disabled ?? false,
    firstUsed: known?.firstUsed ?? false,
  };
}

/** New rows may only be priced in a currency the viewer has enabled. */
export function canAddIn(code: string, viewerEnabled: readonly CurrencyDefinition[]): boolean {
  return viewerEnabled.some((definition) => definition.code === code && !definition.disabled);
}
