"use server";

import type { ExpectedUnits } from "@/lib/currency-intent";
import { revalidatePath } from "next/cache";
import { actionClient, type ActionError, type ActionResult } from "@/lib/supabase/action";
import {
  cycleMutationSchema, cyclePaymentInputSchema, receiveSalaryInputSchema,
  type CycleMutation, type CyclePaymentInput, type ReceiveSalaryInput,
} from "./cycle-input";

const mutationRows = cycleMutationSchema.array().length(1);

function ruleError(error: { code?: string; message?: string }): ActionError {
  if (error.message === "currency.intentConflict" || error.code === "BT003") return "conflict";
  if (error.code !== "P0001") return "failed";
  switch (error.message) {
    case "already paid this cycle": return "alreadyPaidThisCycle";
    case "salary cycle changed": return "cycleChanged";
    case "installment payment changed": return "paymentChanged";
    case "transaction request already used": return "requestAlreadyUsed";
    case "exceeds remaining": return "exceedsRemaining";
    case "wallet not found or archived":
    case "salary wallet not found or archived":
    case "wallet is archived":
    case "wallet unavailable": return "walletUnavailable";
    case "salary category not found":
    case "category_unavailable":
    case "category_not_found": return "categoryUnavailable";
    case "salary not configured":
    case "invalid salary request":
    case "invalid installment payment":
    case "invalid installment cycle":
    case "invalid installment date":
    case "installment not found": return "invalid";
    case "transaction conflict": return "conflict";
    default: return "failed";
  }
}

async function mutate(
  rpc: "receive_salary" | "record_installment_payment",
  requestId: string,
  args: Record<string, string | number | null>,
  expectedUnits?: ExpectedUnits,
): Promise<ActionResult<CycleMutation>> {
  try {
    const ctx = await actionClient(expectedUnits);
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.rpc(rpc, args);
    if (error) return { ok: false, error: ruleError(error) };
    const parsed = mutationRows.safeParse(data);
    if (!parsed.success || parsed.data[0].id !== requestId) return { ok: false, error: "failed" };
    revalidatePath("/", "layout");
    return { ok: true, ...parsed.data[0] };
  } catch {
    // The caller retains the same input/request UUID when resolving an unknown
    // outcome. Neither transport diagnostics nor raw database errors are public.
    return { ok: false, error: "failed" };
  }
}

/** Receipt amount/wallet/category/timezone are read inside the locked SQL RPC. */
export async function receiveSalaryForCycle(input: ReceiveSalaryInput): Promise<ActionResult<CycleMutation>> {
  const parsed = receiveSalaryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return mutate("receive_salary", parsed.data.requestId, {
    p_request_id: parsed.data.requestId,
    p_expected_cycle_id: parsed.data.expectedCycleId,
  }, parsed.data.expectedUnits);
}

/** One atomic source-aware expense; there is no application read-then-insert. */
export async function payInstallmentForCycle(input: CyclePaymentInput): Promise<ActionResult<CycleMutation>> {
  const parsed = cyclePaymentInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const p = parsed.data;
  return mutate("record_installment_payment", p.requestId, {
    p_request_id: p.requestId, p_installment_id: p.installmentId, p_balance_id: p.balanceId,
    p_amount_minor: p.amountMinor, p_occurred_on: p.occurredOn,
    p_salary_cycle_id: p.salaryCycleId, p_override_of_transaction_id: p.overrideOfTransactionId,
  }, p.expectedUnits);
}
