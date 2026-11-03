"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { useComposer } from "@/components/shell/composer";
import { EmptyState } from "@/components/shell/empty-state";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { usePathname, useRouter } from "@/i18n/navigation";
import { categoryName } from "@/features/categories/schema";
import { loadTransactions } from "@/features/transactions/actions";
import { addDays, groupByDay, todayIn } from "@/features/transactions/group";
import type { Cursor, Filters, Page } from "@/features/transactions/schema";
import { cn } from "@/lib/utils";

const KINDS = ["all", "expense", "income"] as const;

function toQuery(filters: Filters): Record<string, string> {
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>;
}

function dayTitle(date: string, today: string, locale: string, t: (k: string) => string): string {
  if (date === today) return t("today");
  if (date === addDays(today, -1)) return t("yesterday");
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-LB-u-nu-latn" : "en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function ActivityView({ filters, initial }: { filters: Filters; initial: Page }) {
  const t = useTranslations("Activity");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { timezone, wallets } = useAppData();
  const { openDetail, openAdd } = useComposer();
  const [rows, setRows] = useState(initial.rows);
  const [next, setNext] = useState<Cursor | null>(initial.next);
  const [loading, startLoading] = useTransition();
  const [loadFailed, setLoadFailed] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [q, setQ] = useState(filters.q ?? "");
  const sentinel = useRef<HTMLDivElement>(null);
  const today = todayIn(timezone);

  // Server re-renders hand us a fresh first page (after a save, delete or filter change).
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setRows(initial.rows);
    setNext(initial.next);
    setLoadFailed(false);
  }

  const apply = (patch: Partial<Filters>) =>
    router.replace({ pathname, query: toQuery({ ...filters, ...patch }) }, { scroll: false });

  // Debounced search.
  useEffect(() => {
    if ((filters.q ?? "") === q.trim()) return;
    const id = setTimeout(() => apply({ q: q.trim() || undefined }), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const loadMore = () => {
    if (!next || loading) return;
    setLoadFailed(false);
    startLoading(async () => {
      try {
        const page = await loadTransactions(filters, next);
        setRows((r) => [...r, ...page.rows]);
        setNext(page.next);
      } catch {
        setLoadFailed(true);
      }
    });
  };

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !next) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    }, { rootMargin: "300px" });
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, loading]);

  const groups = useMemo(() => groupByDay(rows), [rows]);
  const kind = filters.kind ?? "all";
  const extraCount = [filters.walletId, filters.categoryId, filters.from, filters.to].filter(Boolean).length;
  const filtered = Boolean(filters.q || filters.kind || extraCount);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <label className="flex min-h-12 flex-1 items-center gap-2.5 rounded-xl border border-input bg-card px-3.5 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
          <Search aria-hidden className="size-5 shrink-0" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
            enterKeyHint="search"
            maxLength={60}
            className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <Button variant="outline" size="icon" className="relative size-12" aria-label={t("filters")} onClick={() => setFilterOpen(true)}>
          <SlidersHorizontal aria-hidden />
          {extraCount > 0 ? (
            <span className="absolute -top-1 -end-1 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
              {extraCount}
            </span>
          ) : null}
        </Button>
      </div>

      <div role="radiogroup" aria-label={t("kind")} className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => apply({ kind: k === "all" ? undefined : k })}
            className="min-h-11 shrink-0 rounded-full border border-border bg-card px-4 text-sm font-medium aria-checked:border-primary aria-checked:bg-primary aria-checked:text-primary-foreground"
          >
            {t(k)}
          </button>
        ))}
        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setQ("");
              router.replace(pathname, { scroll: false });
            }}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 px-2 text-sm font-medium text-primary underline underline-offset-4"
          >
            <X aria-hidden className="size-4" />
            {t("clear")}
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? t("noResultsTitle") : t("emptyTitle")}
          body={filtered ? t("noResultsBody") : t("emptyBody")}
          action={
            filtered ? undefined : (
              <Button onClick={openAdd}>{t("addFirst")}</Button>
            )
          }
        />
      ) : (
        <div className="flex flex-col">
          {groups.map((group, index) => {
            const partial = index === groups.length - 1 && next !== null;
            return (
              <section key={group.date} aria-label={dayTitle(group.date, today, locale, t)}>
                <div className="sticky top-0 z-10 flex items-baseline justify-between gap-3 bg-background py-2.5 text-[13px] text-muted-foreground">
                  <h2 className="text-[14px] font-semibold text-foreground">{dayTitle(group.date, today, locale, t)}</h2>
                  {partial ? null : (
                    <p className="flex gap-3">
                      {(["USD", "LBP"] as const)
                        .filter((c) => group.rows.some((r) => r.currency === c))
                        .map((c) => (
                          <Amount key={c} minor={group.totals[c]} currency={c} sign />
                        ))}
                    </p>
                  )}
                </div>
                <ul className="overflow-hidden rounded-xl border border-border bg-card">
                  {group.rows.map((row) => (
                    <TransactionRow key={row.id} transaction={row} onOpen={openDetail} />
                  ))}
                </ul>
              </section>
            );
          })}
          <div ref={sentinel} aria-hidden className="h-px" />
          {next ? (
            <div className="flex flex-col items-center gap-2 py-4">
              {loadFailed ? <p role="alert" className="text-sm text-over">{t("loadFailed")}</p> : null}
              <Button variant="outline" onClick={loadMore} disabled={loading}>
                {loading ? t("loading") : t("loadMore")}
              </Button>
            </div>
          ) : (
            <p className="py-4 text-center text-[13px] text-muted-foreground">{t("end")}</p>
          )}
        </div>
      )}

      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        wallets={wallets.filter((w) => !w.archived)}
        onApply={(patch) => {
          setFilterOpen(false);
          apply(patch);
        }}
      />
    </div>
  );
}

function FilterSheet({
  open,
  onClose,
  filters,
  wallets,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  filters: Filters;
  wallets: { id: string; name: string; currency: string }[];
  onApply: (patch: Partial<Filters>) => void;
}) {
  const t = useTranslations("Activity");
  const locale = useLocale();
  const { categories, timezone } = useAppData();
  const [walletId, setWalletId] = useState(filters.walletId);
  const [categoryId, setCategoryId] = useState(filters.categoryId);
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");
  const today = todayIn(timezone);
  const chip =
    "min-h-11 rounded-full border border-border bg-card px-4 text-sm font-medium aria-checked:border-2 aria-checked:border-foreground aria-checked:bg-accent";

  // Re-sync from the URL each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setWalletId(filters.walletId);
      setCategoryId(filters.categoryId);
      setFrom(filters.from ?? "");
      setTo(filters.to ?? "");
    }
  }

  const bad = from !== "" && to !== "" && from > to;

  return (
    <SheetShell
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("filters")}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() => onApply({ walletId: undefined, categoryId: undefined, from: undefined, to: undefined })}
          >
            {t("reset")}
          </Button>
          <Button
            disabled={bad}
            onClick={() => onApply({ walletId, categoryId, from: from || undefined, to: to || undefined })}
          >
            {t("apply")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t("wallet")}</legend>
          <div role="radiogroup" aria-label={t("wallet")} className="flex flex-wrap gap-2">
            <button type="button" role="radio" aria-checked={!walletId} onClick={() => setWalletId(undefined)} className={chip}>
              {t("allWallets")}
            </button>
            {wallets.map((w) => (
              <button key={w.id} type="button" role="radio" aria-checked={walletId === w.id} onClick={() => setWalletId(w.id)} className={chip}>
                <bdi>{w.name}</bdi> · {w.currency}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t("category")}</legend>
          <div role="radiogroup" aria-label={t("category")} className="flex flex-wrap gap-2">
            <button type="button" role="radio" aria-checked={!categoryId} onClick={() => setCategoryId(undefined)} className={chip}>
              {t("allCategories")}
            </button>
            {categories.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={categoryId === c.id} onClick={() => setCategoryId(c.id)} className={chip}>
                <bdi>{categoryName(c, locale)}</bdi>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid grid-cols-2 gap-3">
          <legend className="mb-2 text-sm font-medium">{t("dates")}</legend>
          {[
            { label: t("from"), value: from, set: setFrom },
            { label: t("to"), value: to, set: setTo },
          ].map((f) => (
            <label key={f.label} className="flex flex-col gap-1.5 text-sm">
              {f.label}
              <input
                type="date"
                value={f.value}
                max={today}
                min="2000-01-01"
                onChange={(e) => f.set(e.target.value)}
                className={cn("h-12 rounded-lg border border-input bg-card px-3 text-base", bad && "border-over")}
              />
            </label>
          ))}
          {bad ? <p role="alert" className="col-span-2 text-sm text-over">{t("dateOrder")}</p> : null}
        </fieldset>
      </div>
    </SheetShell>
  );
}
