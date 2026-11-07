"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/shell/page-body";

export default function CategoryError({ retry }: { retry: () => void }) {
  const t = useTranslations("Categories");
  const [pending, startTransition] = useTransition();
  return <PageBody><div role="alert" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4"><h1 className="text-lg font-semibold">{t("title")}</h1><p>{t("catalogueError")}</p><Button loading={pending} onClick={() => startTransition(() => retry())}>{t("retry")}</Button></div></PageBody>;
}
