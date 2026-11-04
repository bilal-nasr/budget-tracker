"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** Handles unreadable amounts without exposing financial values or server errors. */
export default function LocaleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("MoneyError");
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-start justify-center gap-4 px-4 py-12">
      <h1 className="text-[28px] font-bold">{t("title")}</h1>
      <p className="text-base text-muted-foreground">{t("body")}</p>
      <Button onClick={reset}>{t("retry")}</Button>
    </main>
  );
}
