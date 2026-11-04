import { z } from "zod";
import { MAX_MINOR, MAX_RATE, type Currency } from "@/lib/money";
import type { ExpenseItem } from "./breakdown";
import type { SettlementSnapshot } from "./settlement-serialization";
export { transactionWriteInputSchema as transactionInputSchema } from "./mutation-input";
export type { TransactionWriteInput as TransactionInput } from "./mutation-input";
export { expenseItemInputSchema } from "./breakdown";
export type { ExpenseItem, ExpenseItemInput, ExpenseItemDraft } from "./breakdown";

/** Kinds a person enters through the Add sheet's category flow. */
export const txnKindSchema = z.enum(["expense", "income"]);
export type TxnKind = z.infer<typeof txnKindSchema>;

/** Every kind a stored row can have. A transfer moves money between two wallets. */
export type RowKind = TxnKind | "transfer" | "loan";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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
  /** The USD to LBP rate used (LBP per 1 USD); saved so the next exchange starts from it. */
  rate: z.number().int().min(1).max(MAX_RATE).optional(),
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
  walletId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type Filters = z.infer<typeof filtersSchema>;

export type Page = { rows: Transaction[]; next: Cursor | null };

/** Signed amount in the row's own wallet: income is positive, expenses and money leaving are negative. */
export const signedMinor = (t: Pick<Transaction, "kind" | "amountMinor"> & Partial<Pick<Transaction, "loanFlow">>) =>
  t.kind === "income" || (t.kind === "loan" && t.loanFlow === "in") ? t.amountMinor : -t.amountMinor;

/** Cost/income reporting, distinct from full signed loan cash movement. */
export function reportingMinor(t: Transaction): number {
  if (t.kind === "income" || t.kind === "expense") return signedMinor(t);
  if (t.kind === "loan" && t.loanEvent === "repayment") return t.loanFlow === "in" ? (t.loanFeeMinor ?? 0) : -(t.loanFeeMinor ?? 0);
  return 0;
}
