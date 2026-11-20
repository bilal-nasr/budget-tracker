"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient, type ActionError, type ActionResult } from "@/lib/supabase/action";

const itemsSchema = z.array(z.strictObject({ id: z.uuid(), revision: z.number().int().positive().max(2_147_483_647) }))
  .min(1).max(100).refine((items) => new Set(items.map((item) => item.id)).size === items.length);

const known: ActionError[] = ["invalid", "conflict", "inUse"];

/**
 * Deletes every chosen client payment or none. Only payments that never received money can go;
 * one with a receipt, or one changed since it was read, stops the whole batch.
 */
export async function deletePendingPayments(items: { id: string; revision: number }[]): Promise<ActionResult> {
  const parsed = itemsSchema.safeParse(items);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { error } = await ctx.supabase.rpc("delete_pending_payments", { p_items: parsed.data });
    if (error) return { ok: false, error: known.find((code) => error.message === `pending.${code}`) ?? "failed" };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}
