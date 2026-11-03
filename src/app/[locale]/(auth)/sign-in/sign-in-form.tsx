"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { signIn, type SignInState } from "@/features/auth/actions";

const initial: SignInState = { error: null };

export function SignInForm() {
  const t = useTranslations("SignIn");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(signIn, initial);
  const message =
    state.error === "credentials"
      ? t("errorCredentials")
      : state.error === "notConfigured"
        ? t("errorNotConfigured")
        : state.error === "invalid"
          ? t("errorInvalid")
          : null;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <TextField
        label={t("email")}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        dir="ltr"
      />
      <TextField
        label={t("password")}
        name="password"
        type="password"
        autoComplete="current-password"
        required
        dir="ltr"
      />
      {message ? (
        <p role="alert" className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">
          {message}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
