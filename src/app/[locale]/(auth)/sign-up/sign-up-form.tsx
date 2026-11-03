"use client";

import { useActionState, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Captcha } from "@/components/auth/captcha";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { signUp, type SignUpState } from "@/features/auth/actions";
import { Link } from "@/i18n/navigation";

const initial: SignUpState = { error: null };

export function SignUpForm() {
  const t = useTranslations("SignUp");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(signUp, initial);
  const [show, setShow] = useState(false);
  // A captcha token works once, so each submit gets a fresh widget.
  const [attempt, setAttempt] = useState(0);
  const helpId = useId();
  const message =
    state.error === "captcha"
      ? t("errorCaptcha")
      : state.error === "weakPassword"
      ? t("errorPassword")
      : state.error === "notConfigured"
        ? t("errorNotConfigured")
        : state.error === "invalid"
          ? t("errorInvalid")
          : state.error === "failed"
            ? t("errorFailed")
            : null;

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
      <div className="flex flex-col gap-1.5">
        <div className="flex items-end gap-2">
          <TextField
            className="flex-1"
            label={t("password")}
            name="password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            aria-describedby={helpId}
            required
            dir="ltr"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            aria-label={show ? t("hidePassword") : t("showPassword")}
            aria-pressed={show}
            onClick={() => setShow((v) => !v)}
          >
            {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </Button>
        </div>
        <p id={helpId} className="text-[13px] text-muted-foreground">{t("passwordHelp")}</p>
      </div>
      <Captcha key={attempt} />
      {message ? (
        <p role="alert" className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">
          {message}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? t("submitting") : t("submit")}
      </Button>
      <p className="text-center text-[15px] text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link href="/sign-in" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">
          {t("signIn")}
        </Link>
      </p>
    </form>
  );
}
