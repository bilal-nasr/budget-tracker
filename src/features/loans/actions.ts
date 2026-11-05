"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withoutCurrencyIntent, type ExpectedUnits } from "@/lib/currency-intent";
import { actionClient, type ActionError, type ActionResult } from "@/lib/supabase/action";
import { getProfile } from "@/features/profile/queries";
import { todayIn } from "@/features/transactions/group";
import { loanCreateSchema, loanEditSchema, loanPaymentSchema, type LoanCreateInput, type LoanEditInput, type LoanPaymentInput } from "./schema";

export type LoanActionError = ActionError;
export type LoanActionResult<T = object> = ActionResult<T>;
const idSchema = z.uuid();
function errorCode(message: string): LoanActionError {
  const known = ["invalid", "exceedsRemaining", "inUse", "loanClosed", "paymentOrder", "termsLocked", "managedTransaction", "conflict"] as const;
  return known.find((code) => message === `loan.${code}`) ?? "failed";
}
async function mutate(name: string, args: Record<string, unknown>, withId: true): Promise<LoanActionResult<{ id: string }>>;
async function mutate(name: string, args: Record<string, unknown>, withId: "revision"): Promise<LoanActionResult<{ id: string; revision: number }>>;
async function mutate(name: string, args: Record<string, unknown>, withId?: false): Promise<LoanActionResult>;
async function mutate(name: string, args: Record<string, unknown>, withId: boolean | "revision" = false): Promise<LoanActionResult<{ id?: string; revision?: number }>> {
  try {
  const input = args.p_input as { expectedUnits?: ExpectedUnits } | undefined;
  const ctx = await actionClient(input?.expectedUnits);
  if (ctx.error) return { ok: false, error: ctx.error };
  const { data, error } = await ctx.supabase.rpc(name, input ? { ...args, p_input: withoutCurrencyIntent(input) } : args);
  if (error) return { ok: false, error: error.message === "currency.intentConflict" ? "conflict" : errorCode(error.message) };
  if (withId) {
    const id = Array.isArray(data) ? data[0]?.id : undefined;
    if (!idSchema.safeParse(id).success) return { ok: false, error: "failed" };
    if (withId === "revision") {
      const revision = data[0]?.revision;
      if (!z.number().int().positive().safeParse(revision).success) return { ok: false, error: "failed" };
      revalidatePath("/", "layout");
      return { ok: true, id, revision };
    }
    revalidatePath("/", "layout");
    return { ok: true, id };
  }
  revalidatePath("/", "layout");
  return { ok: true };
  } catch {
    // A lost response is an unknown outcome; the form retains the exact request.
    return { ok: false, error: "failed" };
  }
}
async function notFuture(date: string): Promise<boolean> {
  const profile = await getProfile();
  return date <= todayIn(profile.timezone);
}
export async function createLoan(input: LoanCreateInput): Promise<LoanActionResult<{ id: string }>> {
  const p = loanCreateSchema.safeParse(input);
  if (!p.success || !(await notFuture(p.data.openedOn))) return { ok: false, error: "invalid" };
  return mutate("create_loan", { p_input: p.data }, true);
}
export async function recordLoanPayment(input: LoanPaymentInput): Promise<LoanActionResult<{ id: string; revision: number }>> {
  const p = loanPaymentSchema.safeParse(input);
  if (!p.success || !(await notFuture(p.data.occurredOn))) return { ok: false, error: "invalid" };
  return mutate("record_loan_payment", { p_input: p.data }, "revision");
}
export async function updateLoan(id: string, input: LoanEditInput): Promise<LoanActionResult> {
  const p = loanEditSchema.safeParse(input);
  if (!idSchema.safeParse(id).success || !p.success) return { ok: false, error: "invalid" };
  return mutate("update_loan", { p_id: id, p_input: p.data });
}
export async function voidLoanPayment(transactionId: string, expectedRevision: number): Promise<LoanActionResult<{ id: string; revision: number }>> {
  if (!idSchema.safeParse(transactionId).success || !z.number().int().positive().safeParse(expectedRevision).success) return { ok: false, error: "invalid" };
  return mutate("void_loan_payment", { p_transaction_id: transactionId, p_expected_revision: expectedRevision }, "revision");
}
export async function restoreLoanPayment(transactionId: string, expectedRevision: number): Promise<LoanActionResult<{ id: string; revision: number }>> {
  if (!idSchema.safeParse(transactionId).success || !z.number().int().positive().safeParse(expectedRevision).success) return { ok: false, error: "invalid" };
  return mutate("restore_loan_payment", { p_transaction_id: transactionId, p_expected_revision: expectedRevision }, "revision");
}
export async function cancelLoan(id: string): Promise<LoanActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  return mutate("cancel_loan", { p_id: id });
}
export async function setLoanArchived(id: string, archived: boolean): Promise<LoanActionResult> {
  if (!idSchema.safeParse(id).success || typeof archived !== "boolean") return { ok: false, error: "invalid" };
  return mutate("set_loan_archived", { p_id: id, p_archived: archived });
}

export async function deleteLoan(id: string): Promise<LoanActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  return mutate("delete_loan", { p_id: id });
}

export async function deleteLoanPayment(transactionId: string, expectedRevision: number): Promise<LoanActionResult> {
  if (!idSchema.safeParse(transactionId).success || !z.number().int().positive().safeParse(expectedRevision).success) return { ok: false, error: "invalid" };
  return mutate("delete_loan_payment", { p_transaction_id: transactionId, p_expected_revision: expectedRevision });
}
