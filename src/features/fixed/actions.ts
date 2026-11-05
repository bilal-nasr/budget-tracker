"use server";

import type { ExpectedUnits } from "@/lib/currency-intent";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient, type ActionResult } from "@/lib/supabase/action";
import { fixedInputSchema, type FixedInput } from "./schema";
import { categoryReferenceError } from "@/features/categories/errors";

const idSchema = z.uuid();

const row = (input: FixedInput) => ({
  name: input.name,
  amount_minor: input.amountMinor,
  balance_id: input.balanceId,
  category_id: input.categoryId,
  due_day: input.dueDay,
  items: input.items ?? [],
});

export async function createFixedExpense(input: FixedInput): Promise<ActionResult> {
  const parsed = fixedInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ctx = await actionClient(parsed.data.expectedUnits);
  if (ctx.error) return { ok: false, error: ctx.error };
  const { error } = await ctx.supabase
    .from("fixed_expenses")
    .insert({ ...row(parsed.data), position: Math.floor(Date.now() / 1000) });
  if (error) return { ok: false, error: error?.message === "currency.intentConflict" ? "conflict" : categoryReferenceError(error) ?? "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateFixedExpense(id: string, input: FixedInput): Promise<ActionResult> {
  const parsed = fixedInputSchema.safeParse(input);
  if (!parsed.success || !idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient(parsed.data.expectedUnits);
  if (ctx.error) return { ok: false, error: ctx.error };
  const { error } = await ctx.supabase.from("fixed_expenses").update(row(parsed.data)).eq("id", id);
  if (error) return { ok: false, error: error?.message === "currency.intentConflict" ? "conflict" : categoryReferenceError(error) ?? "failed" };
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
export async function payFixedExpense(id: string, expectedUnits?: ExpectedUnits): Promise<ActionResult<{ id: string; revision: number }>> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient(expectedUnits);
  if (ctx.error) return { ok: false, error: ctx.error };

  const response = await ctx.supabase.rpc("pay_fixed_expense", { p_id: id });
  const error = response.error;
  const data = Array.isArray(response.data) ? response.data[0] : response.data;
  if (error || !data || !Number.isInteger(data.revision) || data.revision < 1 || data.revision > 2_147_483_647) {
    return { ok: false, error: error?.message === "currency.intentConflict" ? "conflict" : categoryReferenceError(error) ?? "failed" };
  }
  revalidatePath("/", "layout");
  return { ok: true, id: data.id, revision: data.revision };
}
