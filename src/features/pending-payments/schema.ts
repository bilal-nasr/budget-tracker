import { z } from "zod";
import { MAX_MINOR, type Currency } from "@/lib/money";

const date = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "2000-01-01") return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});
const amount = z.number().int().min(1).max(MAX_MINOR);
export const pendingPaymentSchema = z.strictObject({
  requestId: z.uuid(), client: z.string().trim().min(1).max(60), project: z.string().trim().min(1).max(60),
  currency: z.enum(["USD", "LBP", "SYP"]), totalMinor: amount, dueOn: date.nullable(),
});
export const receiptSchema = z.strictObject({
  requestId: z.uuid(), paymentId: z.uuid(), walletId: z.uuid(), categoryId: z.uuid(), amountMinor: amount, occurredOn: date,
});
export type PendingPaymentInput = z.infer<typeof pendingPaymentSchema>;
export type ReceiptInput = z.infer<typeof receiptSchema>;
export type PendingReceipt = { id: string; amountMinor: number; occurredOn: string; walletId: string };
export type PendingPayment = {
  id: string; client: string; project: string; currency: Currency; totalMinor: number; receivedMinor: number;
  remainingMinor: number; dueOn: string | null; revision: number; hasReceiptHistory: boolean;
};
