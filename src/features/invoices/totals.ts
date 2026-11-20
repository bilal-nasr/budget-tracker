import { sumMinor } from "@/lib/money";
import type { CurrencyTotal, InvoiceItem } from "./schema";

/** A row's total: its unit price times its quantity (the database keeps this within the money range). */
export function lineMinor(item: Pick<InvoiceItem, "priceMinor" | "quantity">): number {
  return Number(BigInt(item.priceMinor) * BigInt(item.quantity));
}

/**
 * One total per currency code and decimal places, ordered by first appearance.
 * Different currencies are never added together; a group whose sum is out of range gets `minor: null`.
 */
export function totalsByCurrency(
  items: readonly Pick<InvoiceItem, "currency" | "decimalPlaces" | "priceMinor" | "quantity">[],
): CurrencyTotal[] {
  const groups = new Map<string, { currency: string; decimalPlaces: number; values: number[] }>();
  for (const item of items) {
    const key = `${item.currency}:${item.decimalPlaces}`;
    const group = groups.get(key) ?? { currency: item.currency, decimalPlaces: item.decimalPlaces, values: [] };
    group.values.push(lineMinor(item));
    groups.set(key, group);
  }
  return [...groups.values()].map(({ currency, decimalPlaces, values }) => {
    try {
      return { currency, decimalPlaces, minor: sumMinor(values) };
    } catch {
      return { currency, decimalPlaces, minor: null };
    }
  });
}

/** A row counts as paid only while the expense that paid it is live. */
export const isPaid = (item: Pick<InvoiceItem, "paidOn">) => item.paidOn !== null;

/** "Still to pay": the per-currency totals of the rows nobody has paid yet. */
export function unpaidTotals(
  items: readonly Pick<InvoiceItem, "currency" | "decimalPlaces" | "priceMinor" | "quantity" | "paidOn">[],
): CurrencyTotal[] {
  return totalsByCurrency(items.filter((item) => !isPaid(item)));
}

/** Rows grouped for paying: one group per currency (and its decimals), in order of first appearance. */
export function groupByCurrency<T extends Pick<InvoiceItem, "currency" | "decimalPlaces">>(items: readonly T[]): { currency: string; decimalPlaces: number; rows: T[] }[] {
  const groups = new Map<string, { currency: string; decimalPlaces: number; rows: T[] }>();
  for (const item of items) {
    const key = `${item.currency}:${item.decimalPlaces}`;
    const group = groups.get(key) ?? { currency: item.currency, decimalPlaces: item.decimalPlaces, rows: [] };
    group.rows.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}
