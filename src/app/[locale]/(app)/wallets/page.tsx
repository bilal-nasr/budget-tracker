import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";
import { WalletsView } from "@/components/wallets/wallets-view";

export default function WalletsPage({ params }: PageProps<"/[locale]/wallets">) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const nav = useTranslations("Nav");
  return (
    <>
      <ScreenHeader title={nav("wallets")} />
      <PageBody>
        <WalletsView />
      </PageBody>
    </>
  );
}
