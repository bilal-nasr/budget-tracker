"use client";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export function CycleLoadError() {
  const t = useTranslations("Installments");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <section role="alert" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
    <h2 className="text-[17px] font-semibold">{t("loadErrorTitle")}</h2>
    <p className="text-[15px] text-muted-foreground">{t("loadErrorBody")}</p>
    <Button variant="outline" className="self-start" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{t("retry")}</Button>
  </section>;
}
