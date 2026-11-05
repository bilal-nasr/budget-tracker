import { expectedUnitsSchema } from "@/lib/currency-intent";
import { z } from "zod";
import { MAX_MINOR } from "@/lib/money";
import { calculateLoanFee, calculateLoanPaymentPlan } from "./calculations";

export function isLoanDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "2000-01-01") return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
const date = z.string().refine(isLoanDate);
const minor = z.number().int().min(0).max(MAX_MINOR);
const repaymentPreferences = {
  monthlyPaymentMinor: minor.min(1).nullable().optional(),
  paymentCount: z.number().int().min(1).max(1200).nullable().optional(),
};
const pairedPreferences = (v: { monthlyPaymentMinor?: number | null; paymentCount?: number | null }) =>
  (v.monthlyPaymentMinor === undefined && v.paymentCount === undefined) ||
  (v.monthlyPaymentMinor === null && v.paymentCount === null) ||
  (v.monthlyPaymentMinor != null && v.paymentCount != null);
export const loanCreateSchema = z.strictObject({
  expectedUnits: expectedUnitsSchema.optional(),
  requestId: z.uuid(), name: z.string().trim().min(1).max(60), direction: z.enum(["borrowed", "lent"]),
  principalMinor: minor.min(1), feeBps: z.number().int().min(0).max(10000),
  balanceId: z.uuid(), feeCategoryId: z.uuid(), openedOn: date, creationMode: z.enum(["new", "existing"]),
  principalPaidBeforeMinor: minor, feePaidBeforeMinor: minor,
  ...repaymentPreferences,
}).superRefine((v, ctx) => {
  const fee = calculateLoanFee(v.principalMinor, v.feeBps);
  if (!fee) ctx.addIssue({ code: "custom", path: ["principalMinor"], message: "invalid total" });
  if (v.principalPaidBeforeMinor > v.principalMinor || (fee && v.feePaidBeforeMinor > fee.feeMinor)) ctx.addIssue({ code: "custom", message: "opening amount exceeds component" });
  if (v.creationMode === "new" && (v.principalPaidBeforeMinor !== 0 || v.feePaidBeforeMinor !== 0)) ctx.addIssue({ code: "custom", message: "new loans cannot have opening payments" });
  if (!pairedPreferences(v) || (v.monthlyPaymentMinor != null && v.paymentCount != null && fee && !calculateLoanPaymentPlan(fee.totalDueMinor, v.monthlyPaymentMinor, v.paymentCount))) ctx.addIssue({ code: "custom", path: ["paymentCount"], message: "invalid repayment plan" });
});
export const loanEditSchema = z.strictObject({
  expectedUnits: expectedUnitsSchema.optional(), name: z.string().trim().min(1).max(60), balanceId: z.uuid(), feeCategoryId: z.uuid(), ...repaymentPreferences })
  .refine(pairedPreferences, { path: ["paymentCount"], message: "provide or clear both plan fields" });
export const loanPaymentSchema = z.strictObject({
  expectedUnits: expectedUnitsSchema.optional(), requestId: z.uuid(), loanId: z.uuid(), balanceId: z.uuid(), amountMinor: minor.min(1), occurredOn: date });
export type LoanCreateInput = z.infer<typeof loanCreateSchema>;
export type LoanEditInput = z.infer<typeof loanEditSchema>;
export type LoanPaymentInput = z.infer<typeof loanPaymentSchema>;
export type LoanDirection = LoanCreateInput["direction"];
export type LoanEvent = {
  transactionId: string; revision: number; loanId: string; event: "disbursement" | "repayment"; flow: "in" | "out";
  sequence: number; balanceId: string; occurredOn: string; amountMinor: number; principalMinor: number; feeMinor: number;
  categoryId: string | null; deletedAt: string | null;
};
export type Loan = {
  id: string; name: string; direction: LoanDirection; currency: string; balanceId: string; feeCategoryId: string;
  openedOn: string; creationMode: "new" | "existing"; principalMinor: number; feeBps: number; feeMinor: number;
  totalDueMinor: number; principalPaidBeforeMinor: number; feePaidBeforeMinor: number; principalPaidMinor: number;
  feePaidMinor: number; principalRemainingMinor: number; feeRemainingMinor: number; remainingMinor: number;
  monthlyPaymentMinor: number | null; paymentCount: number | null; finalPaymentMinor: number | null;
  archivedAt: string | null; deletedAt: string | null; events: LoanEvent[];
  historyComplete?: boolean;
  livePaymentCount?: number;
  latestPaymentOn?: string | null;
  latestLivePayment?: { transactionId: string; revision: number; sequence: number } | null;
};
