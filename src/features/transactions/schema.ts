import { expectedUnitsSchema } from "@/lib/currency-intent";
import { z } from "zod";
import { MAX_MINOR, MAX_RATE } from "@/lib/money";
import type { ExpenseItem } from "./breakdown";
import type { SettlementSnapshot } from "./settlement-serialization";
export { transactionWriteInputSchema as transactionInputSchema } from "./mutation-input";
export type { TransactionWriteInput as TransactionInput } from "./mutation-input";
export { expenseItemInputSchema } from "./breakdown";
export type { ExpenseItem, ExpenseItemInput, ExpenseItemDraft } from "./breakdown";
export { signedMinor, reportingMinor } from "./amounts";

/** Kinds a person enters through the Add sheet's category flow. */
export const txnKindSchema = z.enum(["expense", "income"]);
export type TxnKind = z.infer<typeof txnKindSchema>;

/** Stored transfers include both between-wallet Move and within-wallet Exchange. */
export type RowKind = TxnKind | "transfer" | "loan";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Exact existing ledger rows; same-wallet currency changes are Exchange. */
export function classifyBalanceTransfer(source: { id: string; walletId: string; currency: string }, destination: { id: string; walletId: string; currency: string }): "move" | "exchange" {
  if (source.id === destination.id || (source.walletId === destination.walletId && source.currency === destination.currency)) throw new RangeError("Same balance");
  return source.walletId === destination.walletId ? "exchange" : "move";
}
export const transferInputSchema = z.strictObject({
  requestId: z.uuid(),
  expectedUnits: expectedUnitsSchema.optional(),
  occurredOn: z.iso.date().refine((date) => date >= "2000-01-01"),
  sourceBalanceId: z.uuid(), destinationBalanceId: z.uuid(),
  sentMinor: z.number().int().min(1).max(MAX_MINOR),
  receivedMinor: z.number().int().min(1).max(MAX_MINOR),
  rate: z.number().int().min(1).max(MAX_RATE).optional(),
  note: z.string().trim().max(140).optional(),
}).refine((input) => input.sourceBalanceId !== input.destinationBalanceId);

export type TransferInput = z.infer<typeof transferInputSchema>;

export type Transaction = {
  id: string;
  kind: RowKind;
  occurredOn: string;
  /** For a transfer: what left the source wallet, in the source wallet's currency. */
  amountMinor: number;
  currency: string;
  /** Exact source balance ID. */
  balanceId: string;
  walletNameSnapshot?: string | null;
  toWalletNameSnapshot?: string | null;
  /** Null for transfers. */
  categoryId: string | null;
  /** Transfers only: exact destination balance ID and actual amount received. */
  toBalanceId: string | null;
  toAmountMinor: number | null;
  note: string | null;
  createdAt: string;
  revision: number;
  items: ExpenseItem[];
  settlement: SettlementSnapshot | null;
  /** Read-only provenance. Generic writes never accept these fields. */
  source: "salary" | "fixed" | "installment" | "loan" | null;
  fixedExpenseId: string | null;
  installmentId: string | null;
  loanId: string | null;
  loanFlow: "in" | "out" | null;
  loanEvent: "disbursement" | "repayment" | null;
  loanPrincipalMinor: number | null;
  loanFeeMinor: number | null;
  loanEventSeq: number | null;
};

/** Synthetic/new read models only. Real database rows carry their actual token. */
export function emptyTransactionMetadata() {
  return {
    revision: 1, items: [] as ExpenseItem[], settlement: null as SettlementSnapshot | null, source: null as Transaction["source"],
    fixedExpenseId: null as string | null, installmentId: null as string | null,
    loanId: null as string | null, loanFlow: null as Transaction["loanFlow"],
    loanEvent: null as Transaction["loanEvent"], loanPrincipalMinor: null as number | null,
    loanFeeMinor: null as number | null, loanEventSeq: null as number | null,
  };
}

/** Keyset cursor: the last row of the previous page. */
export const cursorSchema = z.object({
  occurredOn: isoDate,
  createdAt: z.string().min(1),
  id: z.uuid(),
});
export type Cursor = z.infer<typeof cursorSchema>;

export const filtersSchema = z.object({
  q: z.string().trim().max(60).optional(),
  kind: z.enum(["expense", "income", "transfer", "loan"]).optional(),
  /** One balance id, or several joined by commas (a wallet and/or currency selection). */
  balanceId: z.string().max(1500).refine((value) => {
    const ids = value.split(",");
    return ids.length <= 40 && ids.every((id) => z.uuid().safeParse(id).success);
  }).optional(),
  categoryId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type Filters = z.infer<typeof filtersSchema>;

export type Page = { rows: Transaction[]; next: Cursor | null };
