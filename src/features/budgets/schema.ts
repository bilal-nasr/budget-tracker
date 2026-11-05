import { expectedUnitsSchema } from "@/lib/currency-intent";
import { currencyCodeSchema } from "@/features/currencies/schema";
import { z } from "zod";
import { MAX_MINOR } from "@/lib/money";

export type BudgetRow = {
  categoryId: string;
  /** Null when the category has spending but no budget. */
  limitMinor: number | null;
  spentMinor: number;
  /** Limit minus spent; negative when over. Null without a limit. */
  leftMinor: number | null;
  /** Spent divided by limit; 0 without a limit. */
  progress: number;
};

export type MonthBudgets = {
  /** YYYY-MM. With a cycle, the month its limits are read from (the cycle start). */
  month: string;
  /** Set when spending is counted per pay cycle instead of the calendar month. */
  cycle?: { from: string; to: string | null };
  currency: string;
  /** Budgeted categories first (in category order), then unbudgeted ones that have spending. */
  rows: BudgetRow[];
  totalLimitMinor: number;
  /** All spending in this currency, budgeted or not. */
  totalSpentMinor: number;
};

export const budgetEditSchema = z.object({
  expectedUnits: expectedUnitsSchema.optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  currency: currencyCodeSchema,
  /** One entry per changed category. A null limit removes the budget from this month on. */
  limits: z
    .array(
      z.object({
        categoryId: z.uuid(),
        limitMinor: z.number().int().min(1).max(MAX_MINOR).nullable(),
      }),
    )
    .max(200),
});
export type BudgetEdit = z.infer<typeof budgetEditSchema>;

/** Raw database rows, shared by the live query and the demo data. */
export type BudgetLimit = { categoryId: string; currency: string; limitMinor: number };
export type CategorySpend = { categoryId: string; currency: string; spentMinor: number };
