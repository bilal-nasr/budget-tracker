"use client";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/shell/page-body";
export default function ItemsError({ reset }: { reset: () => void }) {
  const t = useTranslations("Items");
  const [pending, startTransition] = useTransition();
  return <PageBody><p role="alert">{t("unavailable")}</p><Button variant="outline" loading={pending} onClick={() => startTransition(() => reset())}>{t("retry")}</Button></PageBody>;
}
