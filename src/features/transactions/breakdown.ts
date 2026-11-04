import { z } from "zod";
import { MAX_MINOR, parseAmount, type Currency } from "@/lib/money";

export const MAX_EXPENSE_ITEMS = 50;
export const MAX_ITEM_DESCRIPTION_LENGTH = 140;

/** Descriptions only: items never own a wallet, category, currency or children. */
export const expenseItemInputSchema = z.strictObject({
  description: z.string().trim().min(1).max(MAX_ITEM_DESCRIPTION_LENGTH),
  amountMinor: z.number().int().min(1).max(MAX_MINOR),
});

export type ExpenseItemInput = z.infer<typeof expenseItemInputSchema>;
export type ExpenseItem = ExpenseItemInput & { id: string; position: number };
export type ExpenseItemDraft = { key: string; description: string; amountText: string };

export type BreakdownSummary =
  | { valid: true; itemizedMinor: number; remainderMinor: number }
  | { valid: false; reason: "invalidParent" | "invalidItem" | "exceedsParent" };

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
    if (!expenseItemInputSchema.safeParse({ description: item.description, amountMinor: item.amountMinor }).success) {
      return { valid: false, reason: "invalidItem" };
    }
    total += BigInt(item.amountMinor);
  }
  if (total > BigInt(parentMinor)) return { valid: false, reason: "exceedsParent" };
  const itemizedMinor = Number(total); // Bounded by the already validated parent.
  return { valid: true, itemizedMinor, remainderMinor: parentMinor - itemizedMinor };
}

export type ExpenseItemDraftResult =
  | { valid: true; items: ExpenseItemInput[]; summary: Extract<BreakdownSummary, { valid: true }> }
  | Extract<BreakdownSummary, { valid: false }>;

/** Every draft line must validate. Invalid/blank lines are never discarded. */
export function parseExpenseItemDrafts(
  currency: Currency,
  parentMinor: number | null,
  drafts: readonly ExpenseItemDraft[],
): ExpenseItemDraftResult {
  if (parentMinor === null || !Number.isSafeInteger(parentMinor) || parentMinor < 1 || parentMinor > MAX_MINOR) {
    return { valid: false, reason: "invalidParent" };
  }
  if (drafts.length > MAX_EXPENSE_ITEMS) return { valid: false, reason: "invalidItem" };
  const items: ExpenseItemInput[] = [];
  for (const draft of drafts) {
    const parsed = expenseItemInputSchema.safeParse({
      description: draft.description,
      amountMinor: parseAmount(draft.amountText, currency),
    });
    if (!parsed.success) return { valid: false, reason: "invalidItem" };
    items.push(parsed.data);
  }
  const summary = summarizeBreakdown(parentMinor, items);
  return summary.valid ? { valid: true, items, summary } : summary;
}
