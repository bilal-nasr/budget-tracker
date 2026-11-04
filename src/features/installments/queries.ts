import "server-only";
import { getCycleSnapshot } from "./cycle-queries";
import type { Installment } from "./schema";
export { getCycleSnapshot } from "./cycle-queries";

/** Shares the same receipt/payment snapshot as salary status within a request. */
export async function getInstallments(timezone: string): Promise<Installment[]> {
  return (await getCycleSnapshot(timezone)).installments;
}
