"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { addDays } from "@/features/transactions/group";
import { cn } from "@/lib/utils";

function short(date: string, locale: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-LB-u-nu-latn" : "en-US", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** Previous / next pay cycle (salary to salary), kept in the `?cycle=YYYY-MM-DD` search param. */
export function CycleSwitcher({ from, to, older, newer, className }: {
  from: string; to: string | null; older: string | null; newer: string | null; className?: string;
}) {
  const t = useTranslations("Nav");
  const locale = useLocale();
  const pathname = usePathname();
  const rtl = locale === "ar";
  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;
  const btn = "grid size-11 place-items-center rounded-lg text-shell-foreground hover:bg-white/10";
  const disabled = "grid size-11 place-items-center rounded-lg text-shell-foreground opacity-30";
  const label = `${short(from, locale)} – ${to ? short(addDays(to, -1), locale) : t("cycleNow")}`;
  return (
    <div className={cn("flex items-center", className)}>
      {older ? <Link href={{ pathname, query: { cycle: older } }} aria-label={t("previousCycle")} className={btn} replace><Prev aria-hidden className="size-5" /></Link>
        : <span aria-hidden className={disabled}><Prev className="size-5" /></span>}
      <span className="min-w-36 text-center font-semibold" aria-live="polite"><bdi>{label}</bdi></span>
      {newer ? <Link href={{ pathname, query: { cycle: newer } }} aria-label={t("nextCycle")} className={btn} replace><Next aria-hidden className="size-5" /></Link>
        : <span aria-hidden className={disabled}><Next className="size-5" /></span>}
    </div>
  );
}
