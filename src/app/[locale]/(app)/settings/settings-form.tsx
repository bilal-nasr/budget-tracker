"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/i18n/navigation";
import { updateProfile } from "@/features/profile/actions";
import { signOut } from "@/features/auth/actions";
import type { Profile } from "@/features/profile/schema";

type Theme = Profile["theme"];

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("theme", theme);
  } catch {}
}

const subscribeNoop = () => () => {};

export function SettingsForm({ profile }: { profile: Profile }) {
  const t = useTranslations("Settings");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [digits, setDigits] = useState(profile.digits);
  const [theme, setTheme] = useState<Theme>(profile.theme);
  const [message, setMessage] = useState<string | null>(null);
  // The signed-out/unconfigured preview cannot save to the database.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);

  const save = (patch: Parameters<typeof updateProfile>[0]) => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateProfile(patch);
      if (!result.ok && result.error !== "notConfigured") setMessage(t("saveFailed"));
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="s-lang" className="flex flex-col gap-2">
        <h2 id="s-lang" className="text-[17px] font-semibold">{t("language")}</h2>
        <Segmented
          label={t("language")}
          value={locale as "en" | "ar"}
          onChange={(next) => {
            save({ locale: next });
            router.replace(pathname, { locale: next });
          }}
          options={[
            { value: "en", label: "English" },
            { value: "ar", label: "العربية" },
          ]}
        />
      </section>

      <section aria-labelledby="s-digits" className="flex flex-col gap-2">
        <h2 id="s-digits" className="text-[17px] font-semibold">{t("digits")}</h2>
        <Segmented
          label={t("digits")}
          value={digits}
          onChange={(next) => {
            setDigits(next);
            save({ digits: next });
          }}
          options={[
            { value: "latin", label: <bdi dir="ltr">0 1 2 3</bdi> },
            { value: "arabic", label: <bdi dir="ltr">٠ ١ ٢ ٣</bdi> },
          ]}
        />
        <p className="text-[13px] text-muted-foreground">{t("digitsHelp")}</p>
      </section>

      <section aria-labelledby="s-theme" className="flex flex-col gap-2">
        <h2 id="s-theme" className="text-[17px] font-semibold">{t("theme")}</h2>
        <Segmented
          label={t("theme")}
          value={theme}
          onChange={(next) => {
            setTheme(next);
            applyTheme(next);
            save({ theme: next });
          }}
          options={[
            { value: "system", label: t("themeSystem") },
            { value: "light", label: t("themeLight") },
            { value: "dark", label: t("themeDark") },
          ]}
        />
      </section>

      {message ? (
        <p role="alert" className="text-sm text-over">{message}</p>
      ) : null}

      <form action={signOut} className="border-t border-border pt-6">
        <input type="hidden" name="locale" value={locale} />
        <Button type="submit" variant="outline" className="w-full" disabled={!mounted}>
          {t("signOut")}
        </Button>
      </form>
    </div>
  );
}
