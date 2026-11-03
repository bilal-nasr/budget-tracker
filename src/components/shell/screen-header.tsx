import { Suspense } from "react";
import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { TileBand } from "@/components/tiles/tile-band";
import { MonthSwitcher } from "./month-switcher";

/**
 * The teal shell block at the top of each screen: title (or month switcher),
 * settings on phones, optional lead content, and a band of tiles along the edge.
 */
export function ScreenHeader({
  title,
  month = false,
  children,
}: {
  title?: string;
  month?: boolean;
  children?: React.ReactNode;
}) {
  const t = useTranslations("Nav");
  return (
    <header className="bg-shell text-shell-foreground">
      <div className="mx-auto w-full max-w-[640px] px-4 pt-[calc(0.5rem+var(--safe-top))] lg:max-w-[800px]">
        <div className="flex min-h-[52px] items-center justify-between">
          {month ? (
            <Suspense fallback={<div className="h-11 w-52" />}>
              <MonthSwitcher className="-ms-2" />
            </Suspense>
          ) : null}
          {title ? <h1 className={month ? "sr-only" : "text-lg font-semibold"}>{title}</h1> : month ? <span /> : null}
          <Link
            href="/settings"
            aria-label={t("settings")}
            className="grid size-11 place-items-center rounded-lg hover:bg-white/10 md:hidden"
          >
            <Settings aria-hidden className="size-5" />
          </Link>
        </div>
        {children ? <div className="pt-1 pb-5">{children}</div> : <div className="pb-3" />}
      </div>
      <TileBand />
    </header>
  );
}
