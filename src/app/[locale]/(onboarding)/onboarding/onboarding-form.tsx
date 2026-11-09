"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { TileBand } from "@/components/tiles/tile-band";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { WalletForm } from "@/components/wallets/wallet-sheet";
import { useRouter } from "@/i18n/navigation";
import { afterSignInPath } from "@/features/auth/actions";
import { completeOnboarding, updateProfile } from "@/features/profile/actions";

import type { CurrencyDefinition } from "@/lib/currency";

type Lang = "en" | "ar";

/**
 * First run. Step 1: language. Step 2: first wallet (skippable).
 * A budgets step follows in a later phase.
 */
export function OnboardingForm({ currencies }: { currencies: CurrencyDefinition[] }) {
  const t = useTranslations("Onboarding");
  const current = useLocale() as Lang;
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [lang, setLang] = useState<Lang>(current);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  const finish = () => {
    setError(false);
    startTransition(async () => {
      const done = await completeOnboarding();
      // "notConfigured" is the no-database preview; anything else failing is real.
      if (!done.ok && done.error === "failed") {
        setError(true);
        return;
      }
      // A share link opened before signing up waits until setup is done.
      const next = await afterSignInPath().catch(() => null);
      router.replace(next ?? "/", { locale: lang });
    });
  };

  const toWalletStep = () => {
    setError(false);
    startTransition(async () => {
      const saved = await updateProfile({ locale: lang });
      if (!saved.ok && saved.error === "failed") {
        setError(true);
        return;
      }
      setStep(2);
    });
  };

  return (
    <div className="min-h-dvh">
      <header className="bg-shell text-shell-foreground">
        <div className="mx-auto max-w-[440px] px-4 pt-[calc(2.5rem+var(--safe-top))] pb-8">
          <p className="text-[15px] text-shell-muted">{t("step", { current: step, total: 2 })}</p>
          <h1 className="mt-1 text-[28px] leading-tight font-bold tracking-tight">
            {step === 1 ? t("title") : t("walletTitle")}
          </h1>
          <p className="mt-2 text-[15px] text-shell-muted">{step === 1 ? t("body") : t("walletBody")}</p>
        </div>
        <TileBand />
      </header>
      <main className="mx-auto flex max-w-[440px] flex-col gap-5 px-4 py-8 pb-[calc(2rem+var(--safe-bottom))]">
        {step === 1 ? (
          <>
            <Segmented
              label={t("language")}
              value={lang}
              onChange={(next) => {
                setLang(next);
                router.replace("/onboarding", { locale: next });
              }}
              options={[
                { value: "en", label: "English" },
                { value: "ar", label: "العربية" },
              ]}
            />
            {error ? <p role="alert" className="text-sm text-over">{t("failed")}</p> : null}
            <Button size="lg" className="w-full" onClick={toWalletStep} loading={pending}>
              {t("continue")}
            </Button>
          </>
        ) : (
          <>
            <WalletForm currencies={currencies} wallet={null} onDone={finish} submitLabel={t("createStart")} />
            {error ? <p role="alert" className="text-sm text-over">{t("failed")}</p> : null}
            <Button variant="ghost" onClick={finish} loading={pending}>
              {t("skip")}
            </Button>
          </>
        )}
      </main>
    </div>
  );
}
