"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/supabase/user";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { routing } from "@/i18n/routing";
import { profilePatchSchema, type ProfilePatch } from "./schema";

export type ActionResult = { ok: true } | { ok: false; error: "invalid" | "notConfigured" | "failed" };

/** Saves display preferences for the signed-in owner (RLS limits it to their own row). */
export async function updateProfile(patch: ProfilePatch): Promise<ActionResult> {
  const parsed = profilePatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (!supabaseConfigured()) return { ok: false, error: "notConfigured" };

  const userId = await getUserId();
  if (!userId) return { ok: false, error: "failed" };
  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update(parsed.data)
    .eq("user_id", userId);
  if (error) return { ok: false, error: "failed" };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Remembers the chosen language. No revalidation: the navigation to the other
 * locale already renders the new language, so a refresh would only add renders.
 */
export async function saveLocale(locale: "en" | "ar"): Promise<ActionResult> {
  if (!routing.locales.includes(locale)) return { ok: false, error: "invalid" };
  if (!supabaseConfigured()) return { ok: false, error: "notConfigured" };
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "failed" };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ locale }).eq("user_id", userId);
  return error ? { ok: false, error: "failed" } : { ok: true };
}

/** Marks first-run setup as finished. */
export async function completeOnboarding(): Promise<ActionResult> {
  if (!supabaseConfigured()) return { ok: false, error: "notConfigured" };
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "failed" };
  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) return { ok: false, error: "failed" };

  revalidatePath("/", "layout");
  return { ok: true };
}
