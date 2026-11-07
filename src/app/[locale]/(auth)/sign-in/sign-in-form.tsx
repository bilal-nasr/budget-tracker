"use client";

import { useActionState, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Captcha } from "@/components/auth/captcha";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { resendConfirmation, signIn, type SignInState } from "@/features/auth/actions";
import { Link } from "@/i18n/navigation";

const initial: SignInState = { error: null };

export function SignInForm() {
  const t = useTranslations("SignIn");
  const locale = useLocale();
  const params = useSearchParams();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(signIn, initial);
  const [resent, setResent] = useState(false);
  // A captcha token works once, so each submit gets a fresh widget.
  const [attempt, setAttempt] = useState(0);
  const message =
    state.error === "captcha"
      ? t("errorCaptcha")
      : state.error === "credentials"
      ? t("errorCredentials")
      : state.error === "notConfigured"
        ? t("errorNotConfigured")
        : state.error === "invalid"
          ? t("errorInvalid")
          : state.error === "unconfirmed"
            ? t("errorUnconfirmed")
            : params.get("error") === "link"
              ? t("errorLink")
              : null;

  const [resending, setResending] = useState(false);
  const resend = async () => {
    if (resending) return;
    setResending(true);
    try {
      const data = new FormData(formRef.current ?? undefined);
      await resendConfirmation(String(data.get("email") ?? ""), locale, String(data.get("captchaToken") ?? ""));
      setResent(true);
    } finally {
      setResending(false);
    }
  };

  return (
    <form
      ref={formRef}
      action={(formData) => {
        formAction(formData);
        setAttempt((n) => n + 1);
      }}
      className="flex flex-col gap-4"
      noValidate
    >
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
      <Link href="/forgot-password" className="-mt-2 inline-flex min-h-11 items-center self-start text-[15px] font-medium text-primary underline underline-offset-4">
        {t("forgot")}
      </Link>
      <Captcha key={attempt} />
      {message ? (
        <p role="alert" className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">
          {message}
        </p>
      ) : null}
      {state.error === "unconfirmed" ? (
        resent ? (
          <p role="status" className="text-[15px] text-muted-foreground">{t("resent")}</p>
        ) : (
          <Button type="button" variant="outline" loading={resending} onClick={resend}>
            {t("resend")}
          </Button>
        )
      ) : null}
      <Button type="submit" size="lg" loading={pending} className="w-full">
        {pending ? t("submitting") : t("submit")}
      </Button>
      <p className="text-center text-[15px] text-muted-foreground">
        {t("noAccount")}{" "}
        <Link href="/sign-up" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">
          {t("createAccount")}
        </Link>
      </p>
    </form>
  );
}
