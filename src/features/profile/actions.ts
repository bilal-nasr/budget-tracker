"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { profilePatchSchema, type ProfilePatch } from "./schema";

export type ActionResult = { ok: true } | { ok: false; error: "invalid" | "notConfigured" | "failed" };

/** Saves display preferences for the signed-in owner (RLS limits it to their own row). */
export async function updateProfile(patch: ProfilePatch): Promise<ActionResult> {
  const parsed = profilePatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (!supabaseConfigured()) return { ok: false, error: "notConfigured" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "failed" };

  const { error } = await supabase
    .from("profiles")
    .update(parsed.data)
    .eq("user_id", auth.user.id);
  if (error) return { ok: false, error: "failed" };

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Marks first-run setup as finished. */
export async function completeOnboarding(): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, error: "notConfigured" };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "failed" };

  const { error } = await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("user_id", auth.user.id);
  if (error) return { ok: false, error: "failed" };

  revalidatePath("/", "layout");
  return { ok: true };
}
