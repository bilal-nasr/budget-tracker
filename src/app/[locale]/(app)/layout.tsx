import { redirect } from "@/i18n/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { ComposerProvider } from "@/components/shell/composer";
import { AppDataProvider } from "@/components/providers/app-data";
import { getCategories } from "@/features/categories/queries";
import { getWallets } from "@/features/wallets/queries";
import { DisplayPrefsProvider } from "@/components/providers/display-prefs";
import { getProfile } from "@/features/profile/queries";
import { setRequestLocale } from "next-intl/server";
import { timed } from "@/lib/timing";

export default async function AppLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [profile, wallets, categories] = await Promise.all([
    timed("layout.profile", getProfile),
    timed("layout.wallets", getWallets),
    timed("layout.categories", getCategories),
  ]);
  if (!profile.onboarded) redirect({ href: "/onboarding", locale });

  return (
    <DisplayPrefsProvider digits={profile.digits}>
      <AppDataProvider wallets={wallets} categories={categories} timezone={profile.timezone} salary={profile.salary} usdLbpRate={profile.usdLbpRate}>
        <ComposerProvider>
          <AppShell>{children}</AppShell>
        </ComposerProvider>
      </AppDataProvider>
    </DisplayPrefsProvider>
  );
}
