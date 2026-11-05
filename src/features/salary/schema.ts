import { expectedUnitsSchema } from "@/lib/currency-intent";
import { z } from "zod";
import { MAX_MINOR } from "@/lib/money";
import type { SalaryReceipt } from "@/features/installments/cycle";
import { todayIn } from "@/features/transactions/group";
export { receiveSalaryInputSchema } from "@/features/installments/cycle-input";
export type { ReceiveSalaryInput } from "@/features/installments/cycle-input";

export const salaryInputSchema = z.object({
  expectedUnits: expectedUnitsSchema.optional(),
  amountMinor: z.number().int().min(1).max(MAX_MINOR),
  balanceId: z.uuid(),
});
export type SalaryInput = z.infer<typeof salaryInputSchema>;

export type SalaryStatus = {
  receiptId: string | null;
  /** Date (YYYY-MM-DD) of the latest "Got salary" entry, or null. */
  lastReceivedOn: string | null;
  /** True when that entry falls in the current month. */
  receivedThisMonth: boolean;
};

export function salaryStatusFromReceipt(receipt: SalaryReceipt | null, timezone: string, now = new Date()): SalaryStatus {
  const month = todayIn(timezone, now).slice(0, 7);
  return { receiptId: receipt?.id ?? null, lastReceivedOn: receipt?.occurredOn ?? null,
    receivedThisMonth: receipt !== null && receipt.occurredOn.startsWith(month) };
}
