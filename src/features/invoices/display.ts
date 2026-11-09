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

/** Custom categories in the order they were made, then the default "Other" last. */
export function sortCategories<T extends { id: string; isDefault: boolean; createdAt: string }>(categories: readonly T[]): T[] {
  return [...categories].sort((a, b) =>
    Number(a.isDefault) - Number(b.isDefault) || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id)));
}

/** The default category's name follows the viewer's language; the stored name is only a fallback. */
export function categoryLabel(category: { name: string; isDefault: boolean }, other: string): string {
  return category.isDefault ? other : category.name;
}

/** The category a row shows under: its own, or "Other" when it names one this screen does not know yet. */
export function categoryOf(categoryId: string, categories: readonly { id: string; isDefault: boolean }[]): string | undefined {
  return (categories.find((c) => c.id === categoryId) ?? categories.find((c) => c.isDefault))?.id;
}
