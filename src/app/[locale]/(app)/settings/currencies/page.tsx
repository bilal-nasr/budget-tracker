import { getTranslations, setRequestLocale } from "next-intl/server";
import { CurrenciesManager } from "@/components/currencies/currencies-manager";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";
import { getCurrencies } from "@/features/currencies/queries";
import { getProfile } from "@/features/profile/queries";
import { Link } from "@/i18n/navigation";

export default async function CurrenciesPage({ params }: PageProps<"/[locale]/settings/currencies">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [currencies, profile, t] = await Promise.all([getCurrencies(), getProfile(), getTranslations("CurrencySettings")]);
  return <>
    <ScreenHeader title={t("title")} />
    <PageBody className="lg:max-w-[640px]">
      <Link href="/settings" className="mb-4 inline-flex min-h-11 items-center rounded-lg text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">{t("back")}</Link>
      <CurrenciesManager currencies={currencies} defaultCurrency={profile.defaultCurrency} />
    </PageBody>
  </>;
}
