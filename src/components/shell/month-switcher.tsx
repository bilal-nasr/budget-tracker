"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shift(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Previous / next month, stored in the `?month=YYYY-MM` search param. */
export function MonthSwitcher({ className }: { className?: string }) {
  const t = useTranslations("Nav");
  const locale = useLocale();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("month");
  const month = raw && MONTH.test(raw) ? raw : currentMonth();
  const [y, m] = month.split("-").map(Number);
  const label = new Intl.DateTimeFormat(locale === "ar" ? "ar-LB-u-nu-latn" : "en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  const rtl = locale === "ar";
  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;
  const btn =
    "grid size-11 place-items-center rounded-lg text-shell-foreground hover:bg-white/10";

  return (
    <div className={cn("flex items-center", className)}>
      <Link
        href={{ pathname, query: { month: shift(month, -1) } }}
        aria-label={t("previousMonth")}
        className={btn}
        replace
      >
        <Prev aria-hidden className="size-5" />
      </Link>
      <span className="min-w-28 text-center font-semibold" aria-live="polite">
        {label}
      </span>
      <Link
        href={{ pathname, query: { month: shift(month, 1) } }}
        aria-label={t("nextMonth")}
        className={btn}
        replace
      >
        <Next aria-hidden className="size-5" />
      </Link>
    </div>
  );
}
