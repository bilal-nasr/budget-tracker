import { setRequestLocale } from "next-intl/server";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage({ params }: PageProps<"/[locale]/onboarding">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <OnboardingForm />;
}
