import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { AppShell } from "@/components/shell/app-shell";
import { ComposerProvider } from "@/components/shell/composer";
import { AppDataProvider } from "@/components/providers/app-data";
import { getCategories } from "@/features/categories/queries";
import { getWallets } from "@/features/wallets/queries";
import { getCurrencies } from "@/features/currencies/queries";
import { DisplayPrefsProvider } from "@/components/providers/display-prefs";
import { getProfile } from "@/features/profile/queries";
import { setRequestLocale } from "next-intl/server";
import { timed } from "@/lib/timing";

export default async function AppLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  // The proxy skips paths without a locale prefix (/wallets, /robots.txt), so they land here
  // with no session. [locale]/layout.tsx 404s them too, but layouts render in parallel:
  // refuse before any read runs as `anon` and logs "permission denied".
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [profile, walletContainers, currencies, categories] = await Promise.all([
    timed("layout.profile", getProfile),
    timed("layout.wallets", () => getWallets({ includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true })),
    timed("layout.currencies", getCurrencies),
    timed("layout.categories", getCategories),
  ]);
  if (!profile.onboarded) redirect({ href: "/onboarding", locale });

  return (
    <DisplayPrefsProvider digits={profile.digits}>
      <AppDataProvider walletContainers={walletContainers} currencies={currencies} categories={categories} timezone={profile.timezone} salary={profile.salary} usdLbpRate={profile.usdLbpRate} defaultCurrency={profile.defaultCurrency}>
        <ComposerProvider>
          <AppShell>{children}</AppShell>
        </ComposerProvider>
      </AppDataProvider>
    </DisplayPrefsProvider>
  );
}
