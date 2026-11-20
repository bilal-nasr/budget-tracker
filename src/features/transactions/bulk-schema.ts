import { z } from "zod";
import type { ActionError } from "@/lib/supabase/action";
import type { Transaction } from "./schema";

/** One database call handles at most this many rows; the screen never offers more. */
export const BULK_LIMIT = 200;

/** A row and the revision it was read at; the database refuses anything staler. */
export const revisionRefSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().min(1).max(2_147_483_647),
});
export type RevisionRef = z.infer<typeof revisionRefSchema>;

export const revisionRefsSchema = z.array(revisionRefSchema).min(1).max(BULK_LIMIT)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length);

/** Every row with its new revision (what Undo sends back), or the one reason nothing changed. */
export type BulkTransactionResult = { ok: true; items: RevisionRef[] } | { ok: false; error: ActionError };

/** Loan movements are managed from their loan; the single delete refuses them too. */
export function canBulkDelete(transaction: Pick<Transaction, "kind">): boolean {
  return transaction.kind !== "loan";
}

/**
 * Only expenses and incomes typed in by hand. Salary, fixed-expense, installment and loan rows
 * take their category from their own screen.
 */
export function canBulkRecategorize(transaction: Pick<Transaction, "kind" | "source" | "installmentId" | "fixedExpenseId" | "loanId">): boolean {
  return (transaction.kind === "expense" || transaction.kind === "income")
    && transaction.source === null && transaction.installmentId === null
    && transaction.fixedExpenseId === null && transaction.loanId === null;
}
