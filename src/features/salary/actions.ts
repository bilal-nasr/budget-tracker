"use server";

import { revalidatePath } from "next/cache";
import { actionClient, type ActionResult } from "@/lib/supabase/action";
import { salaryInputSchema, type SalaryInput } from "./schema";
import { receiveSalaryForCycle } from "@/features/installments/cycle-actions";
import type { ReceiveSalaryInput, CycleMutation } from "@/features/installments/cycle-input";

/** Saves the fixed salary amount and the wallet it lands in. */
export async function saveSalary(input: SalaryInput): Promise<ActionResult> {
  const parsed = salaryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };

  const { error } = await ctx.supabase
    .from("profiles")
    .update({ salary_amount_minor: parsed.data.amountMinor, salary_wallet_id: parsed.data.walletId })
    .eq("user_id", ctx.userId);
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function clearSalary(): Promise<ActionResult> {
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const { error } = await ctx.supabase
    .from("profiles")
    .update({ salary_amount_minor: null, salary_wallet_id: null })
    .eq("user_id", ctx.userId);
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Stable receipt identity and expected cycle are validated by the source RPC. */
export async function receiveSalary(input: ReceiveSalaryInput): Promise<ActionResult<CycleMutation>> {
  return receiveSalaryForCycle(input);
}
