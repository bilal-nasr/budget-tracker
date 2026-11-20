"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient, type ActionError } from "@/lib/supabase/action";

const idsSchema = z.array(z.uuid()).min(1).max(100).refine((ids) => new Set(ids).size === ids.length);
const rowsSchema = z.array(z.strictObject({ id: z.uuid(), outcome: z.enum(["deleted", "archived"]) }));

export type RemoveCategoriesResult =
  | { ok: true; deleted: number; archived: number }
  /** `blockedId` names the category a fixed expense, installment or loan still uses. */
  | { ok: false; error: ActionError; blockedId?: string };

/**
 * Removes every chosen category or none: unused ones are deleted, ones with history are archived.
 * One category that is still in use stops the whole batch and is named in the result.
 */
export async function removeCategories(ids: string[]): Promise<RemoveCategoriesResult> {
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.rpc("remove_categories", { p_ids: parsed.data });
    if (error) {
      if (error.message === "category_in_use") {
        const blocked = z.uuid().safeParse(error.details);
        return { ok: false, error: "inUse", ...(blocked.success && parsed.data.includes(blocked.data) ? { blockedId: blocked.data } : {}) };
      }
      return { ok: false, error: error.message === "category_not_found" ? "invalid" : "failed" };
    }
    const rows = rowsSchema.length(parsed.data.length).safeParse(data);
    if (!rows.success || rows.data.some((row) => !parsed.data.includes(row.id))) return { ok: false, error: "failed" };
    revalidatePath("/", "layout");
    const deleted = rows.data.filter((row) => row.outcome === "deleted").length;
    return { ok: true, deleted, archived: rows.data.length - deleted };
  } catch {
    return { ok: false, error: "failed" };
  }
}
