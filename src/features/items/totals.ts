import { sumMinor } from "@/lib/money";
import type { ShoppingItem } from "./schema";

type Line = Pick<ShoppingItem, "priceMinor" | "quantity">;

/** An item's total: its unit price times its quantity (the database keeps this within the money range). */
export function lineMinor(item: Line): number {
  return Number(BigInt(item.priceMinor) * BigInt(item.quantity));
}

/** The total of items in ONE currency (the caller never mixes them); null when it leaves the money range. */
export function totalOf(items: readonly Line[]): number | null {
  try { return sumMinor(items.map(lineMinor)); } catch { return null; }
}

/** How an item reads once bought: "Milk" for one, "Milk × 3" for several. */
export function purchaseLabel(item: { name: string; quantity: number }): string {
  return item.quantity > 1 ? `${item.name} × ${item.quantity}` : item.name;
}
