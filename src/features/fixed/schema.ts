import { z } from "zod";
import { MAX_MINOR } from "@/lib/money";
import { expenseItemInputSchema, MAX_EXPENSE_ITEMS, summarizeBreakdown, type ExpenseItemInput } from "@/features/transactions/breakdown";

export const fixedInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  amountMinor: z.number().int().min(1).max(MAX_MINOR),
  walletId: z.uuid(),
  categoryId: z.uuid(),
  dueDay: z.number().int().min(1).max(31).nullable(),
  items: z.array(expenseItemInputSchema).max(MAX_EXPENSE_ITEMS).default([]),
}).refine((input) => summarizeBreakdown(input.amountMinor, input.items).valid, {
  message: "Breakdown exceeds total", path: ["items"],
});
export type FixedInput = z.input<typeof fixedInputSchema>;

export type FixedExpense = {
  id: string;
  name: string;
  amountMinor: number;
  walletId: string;
  categoryId: string;
  dueDay: number | null;
  /** Date (YYYY-MM-DD) it was recorded as paid this month, or null. */
  paidOn: string | null;
  items?: ExpenseItemInput[];
};
