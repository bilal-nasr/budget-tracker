"use server";

import { z } from "zod";
import { getLoanHistory, type LoanHistoryPage } from "./queries";

export async function loadLoanHistory(id: string, before: number | null): Promise<LoanHistoryPage> {
  if (!z.uuid().safeParse(id).success || (before !== null && !z.number().int().min(0).max(2_147_483_647).safeParse(before).success)) {
    throw new Error("loansUnavailable");
  }
  return getLoanHistory(id, before);
}
