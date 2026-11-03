"use server";

import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";

export type SignInState = {
  error: "invalid" | "notConfigured" | "credentials" | null;
};

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
  locale: z.enum(routing.locales),
});

/**
 * Single-owner sign-in. The email is checked against OWNER_EMAIL before
 * Supabase is called; the proxy enforces the same rule on every request.
 */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return { error: "invalid" };

  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!supabaseConfigured() || !owner) return { error: "notConfigured" };
  // Same message as a wrong password, so the form never reveals who the owner is.
  if (parsed.data.email !== owner) return { error: "credentials" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { error: "credentials" };

  redirect({ href: "/", locale: parsed.data.locale });
  return { error: null };
}

export async function signOut(formData: FormData): Promise<void> {
  const locale = z.enum(routing.locales).catch(routing.defaultLocale).parse(formData.get("locale"));
  if (supabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect({ href: "/sign-in", locale });
}
