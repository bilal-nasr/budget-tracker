"use server";

import { z } from "zod";
import { siteBase } from "@/features/auth/redirect";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";

export type SignInState = {
  error: "invalid" | "notConfigured" | "credentials" | "unconfirmed" | "captcha" | null;
};

export type SignUpState = {
  error: "invalid" | "notConfigured" | "weakPassword" | "captcha" | "failed" | null;
};

const localeSchema = z.enum(routing.locales);
const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
  locale: localeSchema,
});

/** The Turnstile token from the form, when the bot check is on. Empty means none. */
const captchaTokenOf = (formData: FormData): string | undefined => {
  const value = formData.get("captchaToken");
  return typeof value === "string" && value !== "" ? value : undefined;
};

const isCaptchaError = (error: { code?: string; message?: string }) =>
  error.code === "captcha_failed" || /captcha/i.test(error.message ?? "");

/**
 * The link target for the confirmation email: our own confirm route, with the
 * page to continue to. The email template appends the token to this URL, so the
 * link never depends on the project's Site URL setting. It must be on the
 * Supabase redirect allow-list (https://<domain>/**), or Supabase replaces it.
 */
const confirmUrl = (locale: string) =>
  `${siteBase(process.env.NEXT_PUBLIC_SITE_URL, "http://localhost:3000")}/auth/confirm?next=/${locale}/onboarding`;

/**
 * Sign-in with email and password. A wrong password and an unknown email give
 * the same message. An account that has not confirmed its email says so.
 */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return { error: "invalid" };
  if (!supabaseConfigured()) return { error: "notConfigured" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { captchaToken: captchaTokenOf(formData) },
  });
  if (error) {
    if (isCaptchaError(error)) return { error: "captcha" };
    return { error: error.code === "email_not_confirmed" ? "unconfirmed" : "credentials" };
  }

  redirect({ href: "/", locale: parsed.data.locale });
  return { error: null };
}

const signUpSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(72),
  locale: localeSchema,
});

/**
 * Creates an account and sends the confirmation email. Whether or not the
 * email already has an account, the person lands on the same "check your
 * email" screen, so the form never reveals who has an account.
 */
export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const locale = localeSchema.catch(routing.defaultLocale).parse(formData.get("locale"));
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    locale,
  });
  if (!parsed.success) {
    const weak = parsed.error.issues.some((i) => i.path[0] === "password");
    return { error: weak ? "weakPassword" : "invalid" };
  }
  if (!supabaseConfigured()) return { error: "notConfigured" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: confirmUrl(locale), captchaToken: captchaTokenOf(formData) },
  });
  if (error) {
    if (isCaptchaError(error)) return { error: "captcha" };
    if (error.code === "weak_password") return { error: "weakPassword" };
    return { error: "failed" };
  }
  redirect({ href: "/check-email", locale });
  return { error: null };
}

/** Sends the confirmation email again. Always reports ok, so it reveals nothing about the email. */
export async function resendConfirmation(
  email: string,
  locale: string,
  captchaToken?: string,
): Promise<{ ok: boolean }> {
  const parsed = z.object({ email: emailSchema, locale: localeSchema }).safeParse({ email, locale });
  if (!parsed.success || !supabaseConfigured()) return { ok: false };
  const supabase = await createClient();
  await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: confirmUrl(parsed.data.locale), captchaToken: captchaToken || undefined },
  });
  return { ok: true };
}

export async function signOut(formData: FormData): Promise<void> {
  const locale = localeSchema.catch(routing.defaultLocale).parse(formData.get("locale"));
  if (supabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect({ href: "/sign-in", locale });
}
