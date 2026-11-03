"use client";

import { useActionState, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { updatePassword, type ResetPasswordState } from "@/features/auth/actions";

const initial: ResetPasswordState = { error: null };

export function ResetPasswordForm() {
  const t = useTranslations("ResetPassword");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(updatePassword, initial);
  const [show, setShow] = useState(false);
  const helpId = useId();

  const message =
    state.error === "weakPassword"
      ? t("errorPassword")
      : state.error === "mismatch"
        ? t("errorMismatch")
        : state.error === "notConfigured"
          ? t("errorNotConfigured")
          : state.error === "invalid"
            ? t("errorInvalid")
            : state.error === "failed"
              ? t("errorFailed")
              : null;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
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
      <TextField
        label={t("confirm")}
        name="confirm"
        type={show ? "text" : "password"}
        autoComplete="new-password"
        minLength={8}
        maxLength={72}
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
