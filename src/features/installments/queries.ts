import "server-only";
import { getCycleSummary } from "./cycle-queries";
import type { Installment } from "./schema";
export { getCycleSummary } from "./cycle-queries";

/** Shares the same receipt/payment snapshot as salary status within a request. */
export async function getInstallments(timezone: string): Promise<Installment[]> {
  return (await getCycleSummary(timezone)).installments;
}
