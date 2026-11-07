"use server";

import { revalidatePath } from "next/cache";
import { actionClient, type ActionResult } from "@/lib/supabase/action";
import { z } from "zod";
import { todayIn } from "@/features/transactions/group";
import { salaryInputSchema, type SalaryInput } from "./schema";
import { scheduleSalaryEmail } from "./email/schedule";
import { receiveSalaryForCycle } from "@/features/installments/cycle-actions";
import type { ReceiveSalaryInput, CycleMutation } from "@/features/installments/cycle-input";

/**
 * Corrects only the date a salary receipt arrived. Amount, wallet and the
 * installment cycle (ordered by recording time, not by date) stay untouched.
 */
export async function correctSalaryDate(receiptId: string, date: string): Promise<ActionResult> {
  const parsed = z.object({ id: z.uuid(), date: z.iso.date().refine((d) => d >= "2000-01-01") }).safeParse({ id: receiptId, date });
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const owner = await ctx.supabase.from("profiles").select("timezone").eq("user_id", ctx.userId).maybeSingle();
  if (owner.error || !owner.data) return { ok: false, error: "failed" };
  if (parsed.data.date > todayIn(owner.data.timezone)) return { ok: false, error: "invalid" };
  const { data, error } = await ctx.supabase.from("transactions").update({ occurred_on: parsed.data.date })
    .eq("id", parsed.data.id).eq("user_id", ctx.userId).eq("source", "salary").is("deleted_at", null).select("id").maybeSingle();
  if (error) return { ok: false, error: "failed" };
  if (!data) return { ok: false, error: "conflict" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Saves the fixed salary amount and the wallet it lands in. */
export async function saveSalary(input: SalaryInput): Promise<ActionResult> {
  const parsed = salaryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ctx = await actionClient(parsed.data.expectedUnits);
  if (ctx.error) return { ok: false, error: ctx.error };

  const { error } = await ctx.supabase
    .from("profiles")
    .update({ salary_amount_minor: parsed.data.amountMinor, salary_balance_id: parsed.data.balanceId })
    .eq("user_id", ctx.userId);
  if (error) return { ok: false, error: error.message === "currency.intentConflict" ? "conflict" : "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function clearSalary(): Promise<ActionResult> {
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const { error } = await ctx.supabase
    .from("profiles")
    .update({ salary_amount_minor: null, salary_balance_id: null })
    .eq("user_id", ctx.userId);
  if (error) return { ok: false, error: error.message === "currency.intentConflict" ? "conflict" : "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Stable receipt identity and expected cycle are validated by the source RPC. */
export async function receiveSalary(input: ReceiveSalaryInput): Promise<ActionResult<CycleMutation>> {
  const result = await receiveSalaryForCycle(input);
  if (result.ok) scheduleSalaryEmail(result.id);
  return result;
}
