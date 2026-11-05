import { setRequestLocale } from "next-intl/server";
import { getCurrencies } from "@/features/currencies/queries";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage({ params }: PageProps<"/[locale]/onboarding">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const currencies = await getCurrencies();
  return <OnboardingForm currencies={currencies.filter((currency) => !currency.disabled)} />;
}
