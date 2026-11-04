// Kept free of zod so client components can import it without the validation library.
import type { Transaction } from "./schema";

/** Signed amount in the row's own wallet: income is positive, expenses and money leaving are negative. */
export const signedMinor = (t: Pick<Transaction, "kind" | "amountMinor"> & Partial<Pick<Transaction, "loanFlow">>) =>
  t.kind === "income" || (t.kind === "loan" && t.loanFlow === "in") ? t.amountMinor : -t.amountMinor;

/** Cost/income reporting, distinct from full signed loan cash movement. */
export function reportingMinor(t: Transaction): number {
  if (t.kind === "income" || t.kind === "expense") return signedMinor(t);
  if (t.kind === "loan" && t.loanEvent === "repayment") return t.loanFlow === "in" ? (t.loanFeeMinor ?? 0) : -(t.loanFeeMinor ?? 0);
  return 0;
}
