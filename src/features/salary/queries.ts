import "server-only";
import { getCycleSnapshot } from "@/features/installments/cycle-queries";
import { salaryStatusFromReceipt, type SalaryStatus } from "./schema";

/** Recording-order receipt identity; the month badge never resets installments. */
export async function getSalaryStatus(timezone: string): Promise<SalaryStatus> {
  return salaryStatusFromReceipt((await getCycleSnapshot(timezone)).receipt, timezone);
}
