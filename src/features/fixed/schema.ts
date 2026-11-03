import { z } from "zod";
import { MAX_MINOR } from "@/lib/money";

export const fixedInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  amountMinor: z.number().int().min(1).max(MAX_MINOR),
  walletId: z.uuid(),
  categoryId: z.uuid(),
  dueDay: z.number().int().min(1).max(31).nullable(),
});
export type FixedInput = z.infer<typeof fixedInputSchema>;

export type FixedExpense = {
  id: string;
  name: string;
  amountMinor: number;
  walletId: string;
  categoryId: string;
  dueDay: number | null;
  /** Date (YYYY-MM-DD) it was recorded as paid this month, or null. */
  paidOn: string | null;
};
