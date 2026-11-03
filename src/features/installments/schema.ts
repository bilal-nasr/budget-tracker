import { z } from "zod";
import { MAX_MINOR, type Currency } from "@/lib/money";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const installmentInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    totalMinor: z.number().int().min(1).max(MAX_MINOR),
    /** Paid before the app existed. */
    paidBeforeMinor: z.number().int().min(0).max(MAX_MINOR),
    /** Default wallet; fixes the installment's currency. */
    walletId: z.uuid(),
    categoryId: z.uuid(),
    monthlyMinor: z.number().int().min(1).max(MAX_MINOR).nullable(),
    dueDay: z.number().int().min(1).max(31).nullable(),
  })
  .refine((v) => v.paidBeforeMinor <= v.totalMinor);
export type InstallmentInput = z.infer<typeof installmentInputSchema>;

export const installmentPaymentSchema = z.object({
  installmentId: z.uuid(),
  walletId: z.uuid(),
  amountMinor: z.number().int().min(1).max(MAX_MINOR),
  occurredOn: isoDate,
});
export type InstallmentPaymentInput = z.infer<typeof installmentPaymentSchema>;

export type InstallmentPayment = {
  transactionId: string;
  amountMinor: number;
  occurredOn: string;
  walletId: string;
};

export type Installment = {
  id: string;
  name: string;
  currency: Currency;
  walletId: string;
  categoryId: string;
  totalMinor: number;
  paidBeforeMinor: number;
  monthlyMinor: number | null;
  dueDay: number | null;
  /** Paid before the app plus every live payment. */
  paidMinor: number;
  remainingMinor: number;
  paidThisMonthMinor: number;
  /** Newest first. */
  payments: InstallmentPayment[];
};

/** What this installment asks for this month: the monthly amount, never more than what is left. */
export function dueThisMonth(i: Pick<Installment, "monthlyMinor" | "remainingMinor" | "paidThisMonthMinor">): number {
  if (i.monthlyMinor === null) return 0;
  return Math.min(i.monthlyMinor, i.remainingMinor + i.paidThisMonthMinor);
}

/** Builds an Installment's progress from its stored fields and live payments (newest first). */
export function withProgress(
  base: Omit<Installment, "paidMinor" | "remainingMinor" | "paidThisMonthMinor" | "payments">,
  payments: InstallmentPayment[],
  monthStart: string,
): Installment {
  const paidPayments = payments.reduce((sum, p) => sum + p.amountMinor, 0);
  const paidThisMonthMinor = payments
    .filter((p) => p.occurredOn >= monthStart)
    .reduce((sum, p) => sum + p.amountMinor, 0);
  const paidMinor = base.paidBeforeMinor + paidPayments;
  return { ...base, paidMinor, remainingMinor: base.totalMinor - paidMinor, paidThisMonthMinor, payments };
}
