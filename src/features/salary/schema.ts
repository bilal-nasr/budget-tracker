import { z } from "zod";
import { MAX_MINOR } from "@/lib/money";

export const salaryInputSchema = z.object({
  amountMinor: z.number().int().min(1).max(MAX_MINOR),
  walletId: z.uuid(),
});
export type SalaryInput = z.infer<typeof salaryInputSchema>;

export type SalaryStatus = {
  /** Date (YYYY-MM-DD) of the latest "Got salary" entry, or null. */
  lastReceivedOn: string | null;
  /** True when that entry falls in the current month. */
  receivedThisMonth: boolean;
};
