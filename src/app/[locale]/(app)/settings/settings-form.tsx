"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { ChevronRight, ExternalLink, Mail } from "lucide-react";
import { useAppData } from "@/components/providers/app-data";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { saveLocale, setSalaryEmail, updateProfile } from "@/features/profile/actions";
import { applyTheme } from "@/lib/theme";
import { signOut } from "@/features/auth/actions";
import type { Profile } from "@/features/profile/schema";
import { ExportButton } from "./export-button";
import { PasskeysSection } from "./passkeys-section";
import { SignOutButton } from "./sign-out-button";

type Theme = Profile["theme"];

const PORTFOLIO_URL = "https://bilalnasr.com";
const SUPPORT_EMAIL = "me@bilalnasr.com";

const subscribeNoop = () => () => {};

function NavRow({ href, title, hint }: { href: "/settings/categories" | "/settings/currencies"; title: string; hint: React.ReactNode }) {
  return (
    <Link href={href} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-accent/50 active:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block truncate text-[13px] text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
    </Link>
  );
}

export function SettingsForm({ profile }: { profile: Profile }) {
  const t = useTranslations("Settings");
  const { enabledCurrencies } = useAppData();
  const defaultCurrency = profile.defaultCurrency ?? null;
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [digits, setDigits] = useState(profile.digits);
  const [theme, setTheme] = useState<Theme>(profile.theme);
  const [salaryEmail, setSalaryEmailState] = useState(profile.salaryEmail ?? true);
  const [message, setMessage] = useState<string | null>(null);
  // The signed-out/unconfigured preview cannot save to the database.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);

  const save = (patch: Parameters<typeof updateProfile>[0]) => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateProfile(patch);
      if (!result.ok && result.error !== "notConfigured") setMessage(t("saveFailed"));
    });
  };

  const changeSalaryEmail = (next: boolean) => {
    setMessage(null);
    setSalaryEmailState(next);
    startTransition(async () => {
      const result = await setSalaryEmail(next);
      if (!result.ok && result.error !== "notConfigured") {
        setSalaryEmailState(!next);
        setMessage(t("saveFailed"));
      }
    });
  };

  const codes = [...enabledCurrencies].sort((x, y) => Number(y.code === defaultCurrency) - Number(x.code === defaultCurrency)).map((c) => c.code);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="s-prefs" className="flex flex-col gap-2">
        <h2 id="s-prefs" className="text-[17px] font-semibold">{t("preferences")}</h2>
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          <div className="flex flex-col gap-2 p-4">
            <span id="s-lang" className="font-medium">{t("language")}</span>
            <Segmented
              label={t("language")}
              value={locale as "en" | "ar"}
              onChange={(next) => {
                void saveLocale(next);
                startTransition(() => {
                  router.replace({ pathname, query: Object.fromEntries(searchParams) }, { locale: next });
                });
              }}
              options={[
                { value: "en", label: "English" },
                { value: "ar", label: "العربية" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-2 p-4">
            <span id="s-digits" className="font-medium">{t("digits")}</span>
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
          </div>
          <div className="flex flex-col gap-2 p-4">
            <span id="s-theme" className="font-medium">{t("theme")}</span>
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
          </div>
        </div>
      </section>

      <section aria-labelledby="s-notify" className="flex flex-col gap-2">
        <h2 id="s-notify" className="text-[17px] font-semibold">{t("notifications")}</h2>
        <div className="rounded-xl border border-border bg-card">
          <label className="flex min-h-14 cursor-pointer items-center gap-4 p-4">
            <span className="min-w-0 flex-1">
              <span id="s-salary-email" className="block font-medium">{t("salaryEmail")}</span>
              <span id="s-salary-email-help" className="mt-0.5 block text-[13px] text-muted-foreground">{t("salaryEmailHelp")}</span>
            </span>
            <Switch checked={salaryEmail} onChange={changeSalaryEmail} aria-labelledby="s-salary-email" aria-describedby="s-salary-email-help" />
          </label>
        </div>
      </section>

      <section aria-labelledby="s-manage" className="flex flex-col gap-2">
        <h2 id="s-manage" className="text-[17px] font-semibold">{t("manage")}</h2>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          <li><NavRow href="/settings/categories" title={t("categories")} hint={t("categoriesHint")} /></li>
          <li><NavRow href="/settings/currencies" title={t("currencies")} hint={<bdi dir="ltr">{codes.join(" · ")}</bdi>} /></li>
        </ul>
      </section>

      <PasskeysSection />

      <ExportButton />

      <section aria-labelledby="s-about" className="flex flex-col gap-2">
        <h2 id="s-about" className="text-[17px] font-semibold">{t("about")}</h2>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          <li>
            <a href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer" className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-accent/50 active:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-muted-foreground">{t("developedBy")}</span>
                <span className="block font-medium"><bdi>Bilal Nasr</bdi></span>
                <span className="block truncate text-[13px] text-muted-foreground"><bdi dir="ltr">bilalnasr.com</bdi></span>
              </span>
              <ExternalLink aria-hidden className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
              <span className="sr-only">{t("opensNewTab")}</span>
            </a>
          </li>
          <li>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t("supportSubject"))}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-accent/50 active:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t("support")}</span>
                <span className="block text-[13px] text-muted-foreground">{t("supportHint")}</span>
                <span className="block truncate text-[13px] text-muted-foreground"><bdi dir="ltr">{SUPPORT_EMAIL}</bdi></span>
              </span>
              <Mail aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </a>
          </li>
        </ul>
      </section>

      {message ? (
        <p role="alert" className="text-sm text-over">{message}</p>
      ) : null}

      <form action={signOut} className="border-t border-border pt-6">
        <input type="hidden" name="locale" value={locale} />
        <SignOutButton disabled={!mounted}>{t("signOut")}</SignOutButton>
      </form>
    </div>
  );
}
