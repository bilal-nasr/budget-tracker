import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Suspense, use } from "react";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";
import { getProfile } from "@/features/profile/queries";
import { ConnectedAppsSection, ConnectedAppsSkeleton } from "./connected-apps-section";
import { SettingsForm } from "./settings-form";

function SettingsView({ profilePromise }: { profilePromise: ReturnType<typeof getProfile> }) {
  const profile = use(profilePromise);
  const t = useTranslations("Nav");
  return (
    <>
      <ScreenHeader title={t("settings")} />
      <PageBody className="lg:max-w-[640px]">
        <SettingsForm
          profile={profile}
          connectedApps={
            <Suspense fallback={<ConnectedAppsSkeleton />}>
              <ConnectedAppsSection />
            </Suspense>
          }
        />
      </PageBody>
    </>
  );
}

export default function SettingsPage({ params }: PageProps<"/[locale]/settings">) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <SettingsView profilePromise={getProfile()} />;
}
