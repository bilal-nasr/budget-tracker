// Kept free of zod so the read-only breakdown on Home can sum items without the
// validation library. isExpenseItemInput must accept exactly what
// expenseItemInputSchema accepts; breakdown.test.ts pins the equivalence.
import { MAX_MINOR } from "@/lib/money";

export const MAX_EXPENSE_ITEMS = 50;
export const MAX_ITEM_DESCRIPTION_LENGTH = 140;

/** Descriptions only: items never own a wallet, category, currency or children. */
export type ExpenseItemInput = { description: string; amountMinor: number };

export type BreakdownSummary =
  | { valid: true; itemizedMinor: number; remainderMinor: number }
  | { valid: false; reason: "invalidParent" | "invalidItem" | "exceedsParent" };

export function isExpenseItemInput(item: { description: unknown; amountMinor: unknown }): boolean {
  if (typeof item.description !== "string") return false;
  const length = item.description.trim().length;
  return length >= 1 && length <= MAX_ITEM_DESCRIPTION_LENGTH
    && Number.isSafeInteger(item.amountMinor) && (item.amountMinor as number) >= 1 && (item.amountMinor as number) <= MAX_MINOR;
}

/** Sum in BigInt: 50 individually safe amounts can exceed Number's safe range. */
export function summarizeBreakdown(
  parentMinor: number,
  items: readonly ExpenseItemInput[],
): BreakdownSummary {
  if (!Number.isSafeInteger(parentMinor) || parentMinor < 1 || parentMinor > MAX_MINOR) {
    return { valid: false, reason: "invalidParent" };
  }
  if (items.length > MAX_EXPENSE_ITEMS) return { valid: false, reason: "invalidItem" };
  let total = BigInt(0);
  for (const item of items) {
    if (!isExpenseItemInput({ description: item.description, amountMinor: item.amountMinor })) {
      return { valid: false, reason: "invalidItem" };
    }
    total += BigInt(item.amountMinor);
  }
  if (total > BigInt(parentMinor)) return { valid: false, reason: "exceedsParent" };
  const itemizedMinor = Number(total); // Bounded by the already validated parent.
  return { valid: true, itemizedMinor, remainderMinor: parentMinor - itemizedMinor };
}
