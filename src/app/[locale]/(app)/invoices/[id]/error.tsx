"use client";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/shell/page-body";
import { Link } from "@/i18n/navigation";
export default function InvoiceFolderError({ reset }: { reset: () => void }) {
  const t = useTranslations("Invoices");
  const [pending, startTransition] = useTransition();
  return <PageBody>
    <p role="alert">{t("folderUnavailable")}</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" loading={pending} onClick={() => startTransition(() => reset())}>{t("retry")}</Button>
      <Link href="/invoices" className="inline-flex min-h-11 items-center rounded-lg px-1 text-[15px] text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">{t("backToFolders")}</Link>
    </div>
  </PageBody>;
}
