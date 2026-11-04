import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";
import { LoansView } from "@/components/loans/loans-view";
import { getLoans } from "@/features/loans/queries";

export default async function LoansPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Loans");
  const query = await searchParams;
  const id = z.uuid().safeParse(query.loanId);
  const loans = await getLoans();
  return <><ScreenHeader title={t("title")} /><PageBody><LoansView loans={loans} initialLoanId={id.success ? id.data : undefined} /></PageBody></>;
}
