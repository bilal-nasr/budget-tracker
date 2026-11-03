import { z } from "zod";
import { MAX_MINOR, type Currency } from "@/lib/money";

export const txnKindSchema = z.enum(["expense", "income"]);
export type TxnKind = z.infer<typeof txnKindSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const transactionInputSchema = z.object({
  kind: txnKindSchema,
  occurredOn: isoDate,
  walletId: z.uuid(),
  amountMinor: z.number().int().min(1).max(MAX_MINOR),
  categoryId: z.uuid(),
  note: z.string().trim().max(140).optional(),
});

export type TransactionInput = z.infer<typeof transactionInputSchema>;

export type Transaction = {
  id: string;
  kind: TxnKind;
  occurredOn: string;
  amountMinor: number;
  currency: Currency;
  walletId: string;
  categoryId: string;
  note: string | null;
  createdAt: string;
};

/** Keyset cursor: the last row of the previous page. */
export const cursorSchema = z.object({
  occurredOn: isoDate,
  createdAt: z.string().min(1),
  id: z.uuid(),
});
export type Cursor = z.infer<typeof cursorSchema>;

export const filtersSchema = z.object({
  q: z.string().trim().max(60).optional(),
  kind: txnKindSchema.optional(),
  walletId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type Filters = z.infer<typeof filtersSchema>;

export type Page = { rows: Transaction[]; next: Cursor | null };

/** Signed amount for display: expenses negative, income positive. */
export const signedMinor = (t: Pick<Transaction, "kind" | "amountMinor">) =>
  t.kind === "expense" ? -t.amountMinor : t.amountMinor;
