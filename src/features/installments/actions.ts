"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient, type ActionError, type ActionResult } from "@/lib/supabase/action";
import { categoryReferenceError } from "@/features/categories/errors";
import {
  installmentInputSchema,
  type InstallmentInput,
  type InstallmentPaymentInput,
} from "./schema";

import { payInstallmentForCycle } from "./cycle-actions";
import type { CycleMutation } from "./cycle-input";

const idSchema = z.uuid();

const row = (input: InstallmentInput) => ({
  name: input.name,
  total_minor: input.totalMinor,
  paid_before_minor: input.paidBeforeMinor,
  wallet_id: input.walletId,
  category_id: input.categoryId,
  monthly_minor: input.monthlyMinor,
  due_day: input.dueDay,
});

/** Maps the database's rule messages to codes the UI can explain. */
function dbError(message: string): ActionError {
  const categoryError = categoryReferenceError({ message });
  if (categoryError) return categoryError;
  if (message.includes("exceeds remaining")) return "exceedsRemaining";
  if (message.includes("total below paid")) return "totalBelowPaid";
  return "failed";
}

export async function createInstallment(input: InstallmentInput): Promise<ActionResult> {
  const parsed = installmentInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  // `currency` comes from the default wallet via the database trigger.
  const { error } = await ctx.supabase
    .from("installments")
    .insert({ ...row(parsed.data), currency: "USD", position: Math.floor(Date.now() / 1000) });
  if (error) return { ok: false, error: dbError(error.message) };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateInstallment(id: string, input: InstallmentInput): Promise<ActionResult> {
  const parsed = installmentInputSchema.safeParse(input);
  if (!parsed.success || !idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const { error } = await ctx.supabase.from("installments").update(row(parsed.data)).eq("id", id);
  if (error) return { ok: false, error: dbError(error.message) };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Removes the installment. Payments it already recorded stay in Activity. */
export async function deleteInstallment(id: string): Promise<ActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const { error } = await ctx.supabase.rpc("delete_installment", { p_installment_id: id });
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Create one source-aware expense with a stable ID and explicit repeat intent. */
export async function payInstallment(input: InstallmentPaymentInput): Promise<ActionResult<CycleMutation>> {
  return payInstallmentForCycle(input);
}
