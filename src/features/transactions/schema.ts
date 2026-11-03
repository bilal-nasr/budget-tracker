import { z } from "zod";
import { MAX_MINOR, type Currency } from "@/lib/money";

/** Kinds a person enters through the Add sheet's category flow. */
export const txnKindSchema = z.enum(["expense", "income"]);
export type TxnKind = z.infer<typeof txnKindSchema>;

/** Every kind a stored row can have. A transfer moves money between two wallets. */
export type RowKind = TxnKind | "transfer";

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

/**
 * Moving money from one wallet to another. Same currency: both amounts are
 * equal. Different currencies (an exchange): the amounts are what you actually
 * sent and received, so no exchange rate is guessed.
 */
export const transferInputSchema = z.object({
  occurredOn: isoDate,
  fromWalletId: z.uuid(),
  toWalletId: z.uuid(),
  fromAmountMinor: z.number().int().min(1).max(MAX_MINOR),
  toAmountMinor: z.number().int().min(1).max(MAX_MINOR),
  note: z.string().trim().max(140).optional(),
});

export type TransferInput = z.infer<typeof transferInputSchema>;

export type Transaction = {
  id: string;
  kind: RowKind;
  occurredOn: string;
  /** For a transfer: what left the source wallet, in the source wallet's currency. */
  amountMinor: number;
  currency: Currency;
  /** The wallet the money is in, or for a transfer the one it leaves. */
  walletId: string;
  /** Null for transfers. */
  categoryId: string | null;
  /** Transfers only: the wallet the money arrives in, and how much arrives. */
  toWalletId: string | null;
  toAmountMinor: number | null;
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
  kind: z.enum(["expense", "income", "transfer"]).optional(),
  walletId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type Filters = z.infer<typeof filtersSchema>;

export type Page = { rows: Transaction[]; next: Cursor | null };

/** Signed amount in the row's own wallet: income is positive, expenses and money leaving are negative. */
export const signedMinor = (t: Pick<Transaction, "kind" | "amountMinor">) =>
  t.kind === "income" ? t.amountMinor : -t.amountMinor;
