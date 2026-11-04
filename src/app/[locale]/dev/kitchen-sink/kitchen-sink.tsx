"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Settings, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { AmountKeypad } from "@/components/add/amount-keypad";
import { TileBar } from "@/components/budget/tile-bar";
import { Amount } from "@/components/money/amount";
import {
  CategoryGlyph,
  TileGlyph,
  type TileColor,
  type TileId,
} from "@/components/tiles/tile-glyph";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { Link, usePathname } from "@/i18n/navigation";
import { CURRENCIES, currencyPrefix, type Currency } from "@/lib/money";

type Kind = "expense" | "income" | "move";

const CATEGORIES: { key: string; tile: TileId; color: TileColor }[] = [
  { key: "groceries", tile: 3, color: "teal" },
  { key: "transport", tile: 2, color: "oxblood" },
  { key: "eatingOut", tile: 4, color: "ochre" },
  { key: "bills", tile: 1, color: "teal" },
  { key: "health", tile: 6, color: "oxblood" },
  { key: "rent", tile: 7, color: "ochre" },
  { key: "fun", tile: 8, color: "teal" },
  { key: "more", tile: 5, color: "oxblood" },
];

function Row({
  tile,
  color,
  name,
  sub,
  minor,
  currency,
}: {
  tile: TileId;
  color: TileColor;
  name: string;
  sub: string;
  minor: number;
  currency: Currency;
}) {
  return (
    <li className="flex min-h-[60px] items-center gap-3 border-b border-border px-3.5 py-2 last:border-b-0">
      <CategoryGlyph tile={tile} color={color} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          <bdi>{name}</bdi>
        </p>
        <p className="truncate text-[13px] text-muted-foreground">{sub}</p>
      </div>
      <Amount minor={minor} currency={currency} className="font-semibold" />
    </li>
  );
}

export function KitchenSink() {
  const t = useTranslations("Kit");
  const pathname = usePathname();
  const [kind, setKind] = useState<Kind>("expense");
  const [pick, setPick] = useState("groceries");
  const [typed, setTyped] = useState("54.2");
  const [currency, setCurrency] = useState<Currency>("USD");
  // The <html> class is the source of truth (set before paint by the layout script).
  const dark = useSyncExternalStore(
    (notify) => {
      const observer = new MutationObserver(notify);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => observer.disconnect();
    },
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );

  const setTheme = (next: boolean) => {
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  };

  return (
    <div className="mx-auto min-h-dvh max-w-[560px] pb-[calc(2rem+var(--safe-bottom))]">
      {/* Shell lead: the one answer, one tile bar per currency */}
      <header className="bg-shell px-4 pt-[calc(0.5rem+var(--safe-top))] pb-6 text-shell-foreground">
        <div className="flex min-h-[52px] items-center justify-between">
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <Button variant="ghost" size="icon" aria-label={t("theme")} className="text-shell-foreground hover:bg-white/10 hover:text-shell-foreground">
            <Settings aria-hidden />
          </Button>
        </div>
        <p className="text-[15px] text-shell-muted">{t("lead")}</p>
        <p className="mt-1 text-[40px] leading-[1.1] font-bold tracking-tight">
          <Amount minor={41200} currency="USD" />
        </p>
        <TileBar
          tone="shell"
          value={0.66}
          label={`${t("spent")} $788.00 ${t("of")} $1,200.00`}
          className="mt-3.5"
        />
        <p className="mt-2 flex justify-between text-[13px] text-shell-muted">
          <span>
            {t("spent")} <Amount minor={78800} currency="USD" />
          </span>
          <span>
            {t("of")} <Amount minor={120000} currency="USD" />
          </span>
        </p>
        <p className="mt-5 text-[28px] leading-tight font-bold tracking-tight">
          <Amount minor={3150000} currency="LBP" />
        </p>
        <p className="mt-3 text-[28px] leading-tight font-bold tracking-tight">
          <Amount minor={1250} currency="SYP" />
        </p>
        <TileBar
          tone="shell"
          value={0.61}
          label={`${t("spent")} LBP 4,850,000 ${t("of")} LBP 8,000,000`}
          className="mt-3"
        />
      </header>

      <main className="flex flex-col gap-6 px-4 pt-4">
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-xl bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground"
        >
          <TriangleAlert aria-hidden className="size-5 shrink-0 text-over" />
          <span>
            {t("overAlert")} <Amount minor={4000} currency="USD" />
          </span>
          <button
            type="button"
            className="ms-auto min-h-11 shrink-0 px-1 font-semibold underline underline-offset-4"
          >
            {t("seeBudget")}
          </button>
        </div>

        <section aria-labelledby="k-recent" className="flex flex-col gap-2">
          <h2 id="k-recent" className="text-[17px] font-semibold">{t("recent")}</h2>
          <ul className="overflow-hidden rounded-xl border border-border bg-card">
            <Row tile={3} color="teal" name={t("supermarket")} sub={t("groceriesCash")} minor={-5420} currency="USD" />
            <Row tile={2} color="oxblood" name={t("taxi")} sub={t("transportCash")} minor={-400000} currency="LBP" />
            <Row tile={1} color="teal" name={t("bills")} sub={t("billsBank")} minor={-4500} currency="USD" />
            <Row tile={4} color="ochre" name={t("coffee")} sub={t("eatingCash")} minor={-350} currency="USD" />
          </ul>
        </section>

        <section aria-labelledby="k-wallets" className="flex flex-col gap-2">
          <h2 id="k-wallets" className="text-[17px] font-semibold">{t("wallets")}</h2>
          <div className="-mx-4 flex snap-x snap-mandatory scroll-ps-4 gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {[
              { name: t("cashUsd"), minor: 23000, c: "USD" as const },
              { name: t("bankUsd"), minor: 184630, c: "USD" as const },
              { name: t("cashLbp"), minor: 2450000, c: "LBP" as const },
              { name: t("cardUsd"), minor: -12000, c: "USD" as const },
            ].map((w) => (
              <div key={w.name} className="min-h-[72px] min-w-[140px] snap-start rounded-xl border border-border bg-card px-3.5 py-3">
                <p className="text-[13px] text-muted-foreground">{w.name}</p>
                <Amount minor={w.minor} currency={w.c} className="text-lg font-semibold" />
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="k-budget" className="flex flex-col gap-2">
          <h2 id="k-budget" className="text-[17px] font-semibold">{t("categories")}</h2>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {[
              { tile: 3 as TileId, color: "teal" as TileColor, name: t("groceries"), value: 1.13, label: "$340 / $300" },
              { tile: 2 as TileId, color: "oxblood" as TileColor, name: t("transport"), value: 0.52, label: "$62 / $120" },
              { tile: 1 as TileId, color: "teal" as TileColor, name: t("bills"), value: 0.9, label: "$180 / $200" },
            ].map((b) => (
              <div key={b.name} className="border-b border-border px-3.5 py-3 last:border-b-0">
                <div className="mb-2.5 flex items-center gap-3">
                  <CategoryGlyph tile={b.tile} color={b.color} />
                  <div className="flex-1">
                    <p className="font-medium"><bdi>{b.name}</bdi></p>
                    <p className="text-[13px] text-muted-foreground"><bdi dir="ltr" className="amount">{b.label}</bdi></p>
                  </div>
                  {b.value > 1 ? (
                    <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-over">
                      <TriangleAlert aria-hidden className="size-4" />
                      {t("over")}
                    </span>
                  ) : null}
                </div>
                <TileBar value={b.value} label={`${b.name}: ${b.label}`} />
              </div>
            ))}
          </div>
          <p className="text-[13px] text-muted-foreground">{t("limitsNote")}</p>
        </section>

        <section aria-labelledby="k-buttons" className="flex flex-col gap-3">
          <h2 id="k-buttons" className="text-[17px] font-semibold">{t("buttons")}</h2>
          <div className="grid grid-cols-2 gap-2">
            <Button>{t("primary")}</Button>
            <Button variant="action">{t("addLabel")}</Button>
            <Button variant="outline">{t("outline")}</Button>
            <Button variant="ghost">{t("ghost")}</Button>
            <Button variant="destructive">{t("delete")}</Button>
          </div>
          <Segmented
            label={t("choice")}
            value={kind}
            onChange={setKind}
            options={[
              { value: "expense", label: t("expense") },
              { value: "income", label: t("income") },
              { value: "move", label: t("move") },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => toast(t("saved"), { action: { label: t("undo"), onClick: () => {} } })}>
              {t("toast")}
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href={pathname} locale="en" />}>EN</Button>
            <Button variant="ghost" nativeButton={false} render={<Link href={pathname} locale="ar" />}>العربية</Button>
            <Button variant="outline" onClick={() => setTheme(!dark)}>
              {t("theme")}: {dark ? t("dark") : t("light")}
            </Button>
          </div>
        </section>

        <section aria-labelledby="k-tiles" className="flex flex-col gap-2">
          <h2 id="k-tiles" className="text-[17px] font-semibold">{t("categories")}</h2>
          <div className="grid grid-cols-8 gap-1.5 rounded-xl border border-border bg-card p-3 text-tile-teal">
            {([1, 2, 3, 4, 5, 6, 7, 8] as TileId[]).map((id) => (
              <TileGlyph key={id} tile={id} className="size-full" />
            ))}
          </div>
        </section>

        <section aria-labelledby="k-load" className="flex flex-col gap-2">
          <h2 id="k-load" className="text-[17px] font-semibold">{t("loading")}</h2>
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
        </section>

        <section aria-labelledby="k-sheet" className="flex flex-col gap-2">
          <h2 id="k-sheet" className="text-[17px] font-semibold">{t("addSheet")}</h2>
          <Drawer>
            <DrawerTrigger render={<Button variant="action" size="lg" />}>
              {t("openAdd")}
            </DrawerTrigger>
            <DrawerContent className="rounded-t-3xl bg-card">
              <div className="min-h-0 flex-1 overflow-y-auto px-4">
              <DrawerHeader className="px-0 text-start">
                <div className="flex min-h-11 items-center justify-between">
                  <DrawerTitle className="text-[17px] font-semibold">{t("addLabel")}</DrawerTitle>
                  <DrawerClose render={<Button variant="ghost" size="icon" aria-label={t("close")} />}>
                    <X aria-hidden />
                  </DrawerClose>
                </div>
              </DrawerHeader>
              <Segmented
                label={t("choice")}
                value={kind}
                onChange={setKind}
                options={[
                  { value: "expense", label: t("expense") },
                  { value: "income", label: t("income") },
                  { value: "move", label: t("move") },
                ]}
              />
              <div className="flex items-center justify-between gap-3 py-3.5">
                <p className={`amount flex items-baseline gap-1 text-[46px] leading-none font-bold tracking-tight ${typed === "" ? "text-muted-foreground" : ""}`}>
                  <span className="text-[28px] font-semibold text-muted-foreground">{currencyPrefix(currency)}</span>
                  {typed === "" ? "0" : typed}
                </p>
                <Button variant="outline" className="rounded-full" onClick={() => setCurrency(CURRENCIES[(CURRENCIES.indexOf(currency) + 1) % CURRENCIES.length])}>
                  <span className="size-2.5 rounded-full bg-primary" aria-hidden />
                  <bdi dir="ltr">{currency}</bdi>
                  <ChevronDown aria-hidden />
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={pick === c.key}
                    onClick={() => setPick(c.key)}
                    className="flex min-h-[78px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-0.5 py-1.5 text-xs font-medium aria-pressed:border-2 aria-pressed:border-foreground aria-pressed:bg-accent"
                  >
                    <CategoryGlyph tile={c.tile} color={c.color} />
                    {t(c.key)}
                  </button>
                ))}
              </div>
              <AmountKeypad
                className="mt-3"
                value={typed}
                currency={currency}
                onChange={setTyped}
                backspaceLabel={t("backspace")}
              />
              </div>
              <div className="shrink-0 border-t border-border bg-card px-4 pt-2.5 pb-[calc(0.75rem+var(--safe-bottom))]">
                <Button variant="action" size="lg" className="w-full">
                  {t("save")}
                </Button>
              </div>
            </DrawerContent>
          </Drawer>
        </section>
      </main>
      <Toaster />
    </div>
  );
}
