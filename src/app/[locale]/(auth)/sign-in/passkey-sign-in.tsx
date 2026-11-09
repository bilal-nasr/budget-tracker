"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { afterSignInPath } from "@/features/auth/actions";
import { passkeysConfigured, passkeysSupported, signInWithPasskey } from "@/features/passkeys/client";
import type { PasskeyErrorKind } from "@/features/passkeys/errors";
import { useRouter } from "@/i18n/navigation";

const subscribeNoop = () => () => {};

/**
 * "Sign in with a sign-in key": the phone (or password manager) shows its own
 * prompt, so no email or password is typed. Hidden where the browser cannot
 * make the prompt, and in the unconfigured preview.
 */
export function PasskeySignIn({
  captchaToken,
  onAttempt,
}: {
  /** The solved bot-check token from the surrounding form, when the bot check is on. */
  captchaToken: () => string | undefined;
  /** Called after each try, so the form can ask for a fresh single-use bot-check token. */
  onAttempt: () => void;
}) {
  const t = useTranslations("SignIn");
  const router = useRouter();
  // False on the server and during hydration, so the markup matches before the browser check.
  const available = useSyncExternalStore(subscribeNoop, () => passkeysConfigured() && passkeysSupported(), () => false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<PasskeyErrorKind | null>(null);

  if (!available) return null;

  const run = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await signInWithPasskey(captchaToken());
    if (result.ok) {
      // A share link opened while signed out comes first; otherwise home.
      const next = await afterSignInPath().catch(() => null);
      router.replace(next ?? "/");
      router.refresh();
      return;
    }
    setError(result.error);
    setPending(false);
    onAttempt();
  };

  const message =
    error === "cancelled"
      ? t("passkeyCancelled")
      : error === "captcha"
        ? t("errorCaptcha")
        : error === "disabled"
          ? t("passkeyDisabled")
          : error === "domain"
            ? t("passkeyDomain")
            : error === "unsupported"
              ? t("passkeyUnsupported")
              : error
                ? t("passkeyFailed")
                : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-[13px] text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        {t("or")}
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button type="button" variant="outline" size="lg" loading={pending} onClick={run} className="w-full">
        <KeyRound aria-hidden />
        {t("passkey")}
      </Button>
      {message ? (
        <p role={error === "cancelled" ? "status" : "alert"} className="text-[15px] text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
