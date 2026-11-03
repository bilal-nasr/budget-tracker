"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/features/profile/queries";
import { todayIn } from "@/features/transactions/group";
import { actionClient, type ActionResult } from "@/lib/supabase/action";
import { salaryInputSchema, type SalaryInput } from "./schema";

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

/**
 * "Got salary": adds the fixed amount to the salary wallet as income dated
 * today. The amount and wallet come from the saved profile, never the client,
 * so a button press cannot invent a different amount.
 */
export async function receiveSalary(): Promise<ActionResult<{ id: string }>> {
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };

  const profile = await getProfile();
  if (!profile.salary) return { ok: false, error: "invalid" };

  // Prefer the starter "Salary" category; fall back to the first income category.
  const { data: categories } = await ctx.supabase
    .from("categories")
    .select("id, name_en, position")
    .eq("kind", "income")
    .is("archived_at", null)
    .is("parent_id", null)
    .order("position");
  const category = categories?.find((c) => c.name_en === "Salary") ?? categories?.[0];
  if (!category) return { ok: false, error: "failed" };

  const { data, error } = await ctx.supabase
    .from("transactions")
    .insert({
      kind: "income",
      occurred_on: todayIn(profile.timezone),
      wallet_id: profile.salary.walletId,
      amount_minor: profile.salary.amountMinor,
      currency: "USD", // overwritten from the wallet by the database trigger
      category_id: category.id,
      note: "Salary",
      source: "salary",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}
