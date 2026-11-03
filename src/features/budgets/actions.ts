"use server";

import { revalidatePath } from "next/cache";
import { actionClient, type ActionResult } from "@/lib/supabase/action";
import { budgetEditSchema, type BudgetEdit } from "./schema";

/**
 * Saves changed limits. Each one is written as a row starting this month, so
 * earlier months keep their old limit and later months inherit this one.
 */
export async function saveBudgets(input: BudgetEdit): Promise<ActionResult> {
  const parsed = budgetEditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (parsed.data.limits.length === 0) return { ok: true };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };

  const { error } = await ctx.supabase.from("budgets").upsert(
    parsed.data.limits.map((l) => ({
      user_id: ctx.userId,
      category_id: l.categoryId,
      currency: parsed.data.currency,
      starts_month: `${parsed.data.month}-01`,
      limit_minor: l.limitMinor,
    })),
    { onConflict: "user_id,category_id,currency,starts_month" },
  );
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true };
}
