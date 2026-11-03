import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { EmptyState } from "@/components/shell/empty-state";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";

export default function BudgetsPage({ params }: PageProps<"/[locale]/budgets">) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const nav = useTranslations("Nav");
  const t = useTranslations("Soon");
  return (
    <>
      <ScreenHeader title={nav("budgets")} month />
      <PageBody>
        <EmptyState title={t("title")} body={t("budgetsBody")} />
      </PageBody>
    </>
  );
}
