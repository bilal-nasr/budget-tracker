import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";
import { PendingPaymentsView } from "@/components/pending-payments/pending-payments-view";
import { getPendingPayments } from "@/features/pending-payments/queries";

export default async function PendingPaymentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("PendingPayments");
  const payments = await getPendingPayments();
  return <><ScreenHeader title={t("title")} /><PageBody><PendingPaymentsView payments={payments} /></PageBody></>;
}
