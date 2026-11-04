"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/shell/page-body";
export default function PendingPaymentsError({ reset }: { reset: () => void }) {
  const t = useTranslations("PendingPayments");
  return <PageBody><p role="alert">{t("unavailable")}</p><Button variant="outline" onClick={reset}>{t("retry")}</Button></PageBody>;
}
