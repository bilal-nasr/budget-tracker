"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient, type ActionError, type ActionResult } from "@/lib/supabase/action";
import {
  installmentInputSchema,
  installmentPaymentSchema,
  type InstallmentInput,
  type InstallmentPaymentInput,
} from "./schema";

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
  const { error } = await ctx.supabase.from("installments").delete().eq("id", id);
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Records one payment as an expense from any active wallet of the
 * installment's currency. Name and category come from the saved installment.
 */
export async function payInstallment(
  input: InstallmentPaymentInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = installmentPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };

  const { data: item } = await ctx.supabase
    .from("installments")
    .select("id, name, category_id")
    .eq("id", parsed.data.installmentId)
    .maybeSingle();
  if (!item) return { ok: false, error: "invalid" };

  const { data, error } = await ctx.supabase
    .from("transactions")
    .insert({
      kind: "expense",
      occurred_on: parsed.data.occurredOn,
      wallet_id: parsed.data.walletId,
      amount_minor: parsed.data.amountMinor,
      currency: "USD", // overwritten from the wallet by the database trigger
      category_id: item.category_id,
      note: item.name,
      source: "installment",
      installment_id: item.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: dbError(error?.message ?? "") };
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}
