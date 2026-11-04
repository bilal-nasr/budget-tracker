"use server";

import { z } from "zod";
import { getPendingReceipts } from "./queries";
import type { PendingReceipt } from "./schema";

export async function loadPendingReceipts(paymentId: string): Promise<PendingReceipt[]> {
  if (!z.uuid().safeParse(paymentId).success) throw new Error("Pending payments unavailable");
  return getPendingReceipts(paymentId);
}
