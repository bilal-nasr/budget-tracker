"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile } from "@/features/profile/queries";
import { todayIn } from "@/features/transactions/group";
import { actionClient, type ActionResult } from "@/lib/supabase/action";
import { fixedInputSchema, type FixedInput } from "./schema";

const idSchema = z.uuid();

const row = (input: FixedInput) => ({
  name: input.name,
  amount_minor: input.amountMinor,
  wallet_id: input.walletId,
  category_id: input.categoryId,
  due_day: input.dueDay,
});

export async function createFixedExpense(input: FixedInput): Promise<ActionResult> {
  const parsed = fixedInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const { error } = await ctx.supabase
    .from("fixed_expenses")
    .insert({ ...row(parsed.data), position: Math.floor(Date.now() / 1000) });
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateFixedExpense(id: string, input: FixedInput): Promise<ActionResult> {
  const parsed = fixedInputSchema.safeParse(input);
  if (!parsed.success || !idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const { error } = await ctx.supabase.from("fixed_expenses").update(row(parsed.data)).eq("id", id);
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Removes the template. Payments it already recorded stay in Activity. */
export async function deleteFixedExpense(id: string): Promise<ActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const { error } = await ctx.supabase.from("fixed_expenses").delete().eq("id", id);
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * "Paid": records the template as an expense dated today, deducting it from
 * its wallet. Amount, wallet and category come from the saved template, never
 * from the client.
 */
export async function payFixedExpense(id: string): Promise<ActionResult<{ id: string }>> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };

  const { data: item } = await ctx.supabase
    .from("fixed_expenses")
    .select("id, name, amount_minor, wallet_id, category_id")
    .eq("id", id)
    .maybeSingle();
  if (!item) return { ok: false, error: "invalid" };

  const profile = await getProfile();
  const { data, error } = await ctx.supabase
    .from("transactions")
    .insert({
      kind: "expense",
      occurred_on: todayIn(profile.timezone),
      wallet_id: item.wallet_id,
      amount_minor: Number(item.amount_minor),
      currency: "USD", // overwritten from the wallet by the database trigger
      category_id: item.category_id,
      note: item.name,
      source: "fixed",
      fixed_expense_id: item.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}
