"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient } from "@/lib/supabase/action";
import { categoryCreateSchema, categoryEditSchema, type CategoryActionResult, type CategoryCreateInput, type CategoryEditInput } from "./schema";

const idSchema = z.uuid();
type CategoryError = Extract<CategoryActionResult, { ok: false }>["error"];
function dbError(error: { code?: string; message?: string }): CategoryError {
  if (error.code === "23505") return "duplicateName";
  if (error.message === "category_in_use") return "inUse";
  if (error.message === "category_not_found") return "invalid";
  if (error.message === "category_unavailable") return "categoryUnavailable";
  return "failed";
}
const fields = (input: CategoryEditInput) => ({ name_en: input.nameEn, name_ar: input.nameAr, tile: input.tile, color: input.color });

export async function createCategory(input: CategoryCreateInput): Promise<CategoryActionResult<{ id: string }>> {
  const parsed = categoryCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const last = await ctx.supabase.from("categories").select("position").eq("user_id", ctx.userId).eq("kind", parsed.data.kind).is("parent_id", null).order("position", { ascending: false }).limit(1).maybeSingle();
  if (last.error) return { ok: false, error: "failed" };
  const position = (last.data?.position ?? 0) + 1;
  if (!Number.isSafeInteger(position) || position > 2_147_483_647) return { ok: false, error: "failed" };
  const { data, error } = await ctx.supabase.from("categories").insert({ ...fields(parsed.data), kind: parsed.data.kind, user_id: ctx.userId, parent_id: null, position }).select("id").single();
  if (error || !data) return { ok: false, error: error ? dbError(error) : "failed" };
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}

export async function updateCategory(id: string, input: CategoryEditInput): Promise<CategoryActionResult> {
  const parsed = categoryEditSchema.safeParse(input);
  if (!parsed.success || !idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const { data, error } = await ctx.supabase.from("categories").update(fields(parsed.data)).eq("user_id", ctx.userId).eq("id", id).is("parent_id", null).is("archived_at", null).select("id").maybeSingle();
  if (error) return { ok: false, error: dbError(error) };
  if (!data) return { ok: false, error: "invalid" };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeCategory(id: string): Promise<CategoryActionResult<{ outcome: "deleted" | "archived" }>> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const { data, error } = await ctx.supabase.rpc("remove_category", { p_id: id });
  if (error) return { ok: false, error: dbError(error) };
  if (data !== "deleted" && data !== "archived") return { ok: false, error: "failed" };
  revalidatePath("/", "layout");
  return { ok: true, outcome: data };
}

export async function restoreCategory(id: string): Promise<CategoryActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const ctx = await actionClient();
  if (ctx.error) return { ok: false, error: ctx.error };
  const { data, error } = await ctx.supabase.from("categories").update({ archived_at: null }).eq("user_id", ctx.userId).eq("id", id).is("parent_id", null).not("archived_at", "is", null).select("id").maybeSingle();
  if (error) return { ok: false, error: dbError(error) };
  if (!data) return { ok: false, error: "invalid" };
  revalidatePath("/", "layout");
  return { ok: true };
}
