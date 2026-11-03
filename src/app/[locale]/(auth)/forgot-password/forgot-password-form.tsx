"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Captcha } from "@/components/auth/captcha";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { requestPasswordReset, type ForgotPasswordState } from "@/features/auth/actions";
import { Link } from "@/i18n/navigation";

const initial: ForgotPasswordState = { error: null, sent: false };

export function ForgotPasswordForm() {
  const t = useTranslations("ForgotPassword");
  const locale = useLocale();
  const params = useSearchParams();
  const [state, formAction, pending] = useActionState(requestPasswordReset, initial);
  // A captcha token works once, so each submit gets a fresh widget.
  const [attempt, setAttempt] = useState(0);

  const message =
    state.error === "captcha"
      ? t("errorCaptcha")
      : state.error === "notConfigured"
        ? t("errorNotConfigured")
        : state.error === "invalid"
          ? t("errorInvalid")
          : state.error === "failed"
            ? t("errorFailed")
            : params.get("error") === "link"
              ? t("errorLink")
              : null;

  if (state.sent) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="text-[15px]">{t("sent")}</p>
        <p className="text-[15px] text-muted-foreground">{t("sentHelp")}</p>
        <Link
          href="/sign-in"
          className="inline-flex min-h-12 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium"
        >
          {t("toSignIn")}
        </Link>
      </div>
    );
  }

  return (
    <form
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
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        dir="ltr"
      />
      <Captcha key={attempt} />
      {message ? (
        <p role="alert" className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">
          {message}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? t("submitting") : t("submit")}
      </Button>
      <p className="text-center text-[15px]">
        <Link href="/sign-in" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">
          {t("toSignIn")}
        </Link>
      </p>
    </form>
  );
}
