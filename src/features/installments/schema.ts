import { z } from "zod";
import { MAX_MINOR } from "@/lib/money";
export { withProgress, dueThisCycle, canPayNormally, paymentAmountDefault } from "./cycle";
export type { Installment, InstallmentBase, InstallmentPayment } from "./cycle";
export { cyclePaymentInputSchema as installmentPaymentSchema } from "./cycle-input";
export type { CyclePaymentInput as InstallmentPaymentInput } from "./cycle-input";

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
