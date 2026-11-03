import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";
import { getProfile } from "@/features/profile/queries";
import { SettingsForm } from "./settings-form";

function SettingsView({ profilePromise }: { profilePromise: ReturnType<typeof getProfile> }) {
  const profile = use(profilePromise);
  const t = useTranslations("Nav");
  return (
    <>
      <ScreenHeader title={t("settings")} />
      <PageBody className="lg:max-w-[640px]">
        <SettingsForm profile={profile} />
      </PageBody>
    </>
  );
}

export default function SettingsPage({ params }: PageProps<"/[locale]/settings">) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <SettingsView profilePromise={getProfile()} />;
}
