"use client";

import { House, List, PieChart, Plus, Settings, Wallet, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useComposer } from "./composer";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type Destination = { href: "/" | "/activity" | "/budgets" | "/wallets" | "/settings"; key: string; Icon: LucideIcon };

const LEFT: Destination[] = [
  { href: "/", key: "home", Icon: House },
  { href: "/activity", key: "activity", Icon: List },
];
const RIGHT: Destination[] = [
  { href: "/budgets", key: "budgets", Icon: PieChart },
  { href: "/wallets", key: "wallets", Icon: Wallet },
];
const SETTINGS: Destination = { href: "/settings", key: "settings", Icon: Settings };

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

/**
 * Three layouts from one list of destinations:
 * phones get a bottom bar with a raised Add button, tablets a narrow rail,
 * desktops a full sidebar. Add opens the same sheet in every layout.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const { openAdd } = useComposer();

  const tab = ({ href, key, Icon }: Destination) => {
    const active = isActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium text-shell-muted transition-colors",
          "aria-[current=page]:font-bold aria-[current=page]:text-white",
          "md:min-h-16 md:w-16 lg:min-h-11 lg:w-full lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-[15px]",
          "lg:hover:bg-white/10 lg:aria-[current=page]:bg-white/12",
        )}
      >
        <Icon aria-hidden className="size-[22px] group-aria-[current=page]:stroke-[2.4]" />
        <span>{t(key)}</span>
        <span
          aria-hidden
          className="hidden h-[3px] w-[18px] rounded-full bg-white group-aria-[current=page]:block lg:group-aria-[current=page]:hidden"
        />
      </Link>
    );
  };

  return (
    <div className="min-h-dvh md:ps-20 lg:ps-60">
      {/* Tablet rail + desktop sidebar */}
      <nav
        aria-label={t("main")}
        className="fixed inset-y-0 start-0 z-30 hidden w-20 flex-col items-center gap-1 bg-shell px-2 py-4 md:flex lg:w-60 lg:items-stretch lg:px-3"
      >
        <p className="mb-3 hidden px-3 text-lg font-bold text-shell-foreground lg:block">
          {t("appName")}
        </p>
        <Button
          variant="action"
          size="lg"
          onClick={() => openAdd()}
          aria-label={t("add")}
          className="mb-3 size-12 rounded-xl p-0 lg:h-12 lg:w-full lg:px-4"
        >
          <Plus aria-hidden className="size-6" strokeWidth={2.4} />
          <span className="hidden lg:inline">{t("add")}</span>
        </Button>
        {[...LEFT, ...RIGHT].map(tab)}
        <div className="mt-auto flex flex-col items-center gap-1 lg:items-stretch">{tab(SETTINGS)}</div>
      </nav>

      <div className="pb-[calc(104px+var(--safe-bottom))] md:pb-0">{children}</div>

      {/* Phone bottom bar */}
      <nav
        aria-label={t("main")}
        className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(84px+var(--safe-bottom))] grid-cols-[1fr_1fr_84px_1fr_1fr] items-start bg-shell px-1.5 pt-1.5 pb-[var(--safe-bottom)] md:hidden"
      >
        {LEFT.map(tab)}
        <div className="-mt-7 flex flex-col items-center gap-0.5">
          <Button
            variant="action"
            onClick={() => openAdd()}
            aria-label={t("add")}
            className="size-[60px] rounded-[20px] p-0 shadow-md"
          >
            <Plus aria-hidden className="size-7" strokeWidth={2.4} />
          </Button>
          <span aria-hidden className="text-xs font-semibold text-white">
            {t("add")}
          </span>
        </div>
        {RIGHT.map(tab)}
      </nav>

    </div>
  );
}
