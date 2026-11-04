import { z } from "zod";
import { MAX_MINOR, parseAmount, type Currency } from "@/lib/money";
import { MAX_EXPENSE_ITEMS, MAX_ITEM_DESCRIPTION_LENGTH, summarizeBreakdown, type BreakdownSummary, type ExpenseItemInput } from "./breakdown-summary";
export { MAX_EXPENSE_ITEMS, MAX_ITEM_DESCRIPTION_LENGTH, summarizeBreakdown } from "./breakdown-summary";
export type { BreakdownSummary, ExpenseItemInput } from "./breakdown-summary";

/** Descriptions only: items never own a wallet, category, currency or children. */
export const expenseItemInputSchema = z.strictObject({
  description: z.string().trim().min(1).max(MAX_ITEM_DESCRIPTION_LENGTH),
  amountMinor: z.number().int().min(1).max(MAX_MINOR),
}) satisfies z.ZodType<ExpenseItemInput>;

export type ExpenseItem = ExpenseItemInput & { id: string; position: number };
export type ExpenseItemDraft = { key: string; description: string; amountText: string };

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
