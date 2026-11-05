import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Suspense, use } from "react";
import { Commitments } from "@/components/wallets/commitments";
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
        <WalletsView commitments={<Suspense fallback={<div className="h-36 animate-pulse rounded-xl bg-accent" />}><Commitments /></Suspense>} />
      </PageBody>
    </>
  );
}
