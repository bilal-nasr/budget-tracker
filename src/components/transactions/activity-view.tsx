"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { ListChecks, Search, SlidersHorizontal, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { useComposer } from "@/components/shell/composer";
import { EmptyState } from "@/components/shell/empty-state";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/i18n/navigation";
import { loadTransactions } from "@/features/transactions/actions";
import { addDays, groupByDay, sumSelected, todayIn } from "@/features/transactions/group";
import type { Cursor, Filters, Page, Transaction } from "@/features/transactions/schema";

// The filter sheet (and the drawer it needs) loads on first open, then stays
// mounted for its exit animation.
const FilterSheet = dynamic(() => import("./activity-filter-sheet").then((m) => m.FilterSheet));

const KINDS = ["all", "expense", "income", "transfer", "loan"] as const;

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
  const router = useRouter();
  const pathname = usePathname();
  const { walletContainers } = useAppData();
  const wallets = walletContainers.flatMap((wallet) => wallet.balances.map((balance) => ({ id: balance.id, name: wallet.name, currency: balance.currency, walletId: wallet.id, archived: wallet.deleted })));
  const { openAdd } = useComposer();
  const [rows, setRows] = useState(initial.rows);
  const [next, setNext] = useState<Cursor | null>(initial.next);
  const [loading, startLoading] = useTransition();
  const [loadFailed, setLoadFailed] = useState(false);
  const [filterOpen, setFilterOpenState] = useState(false);
  const [filterMounted, setFilterMounted] = useState(false);
  const setFilterOpen = (open: boolean) => { if (open) setFilterMounted(true); setFilterOpenState(open); };
  const [q, setQ] = useState(filters.q ?? "");
  const sentinel = useRef<HTMLDivElement>(null);

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

  // Select mode: tap rows to add them up. Derived from the loaded rows, so a row
  // that was deleted or filtered out never counts.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const selectedRows = useMemo(() => rows.filter((row) => picked.has(row.id)), [rows, picked]);
  const selectedTotals = useMemo(() => sumSelected(selectedRows), [selectedRows]);
  const toggle = useCallback((transaction: Transaction) => {
    setPicked((current) => {
      const nextSet = new Set(current);
      if (!nextSet.delete(transaction.id)) nextSet.add(transaction.id);
      return nextSet;
    });
  }, []);
  const setSelectMode = (on: boolean) => {
    setSelecting(on);
    if (!on) setPicked(new Set());
  };
  const allPicked = rows.length > 0 && selectedRows.length === rows.length;

  const kind = filters.kind ?? "all";
  const extraCount = [filters.balanceId, filters.categoryId, filters.from, filters.to].filter(Boolean).length;
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
        <Button
          variant={selecting ? "default" : "outline"}
          size="icon"
          className="size-12"
          aria-label={t("select")}
          aria-pressed={selecting}
          onClick={() => setSelectMode(!selecting)}
        >
          <ListChecks aria-hidden />
        </Button>
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
              <Button onClick={() => openAdd()}>{t("addFirst")}</Button>
            )
          }
        />
      ) : (
        <div className="flex flex-col">
          <ActivityGroups rows={rows} hasMore={next !== null} selection={selecting ? { picked, onToggle: toggle } : undefined} />
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

      {selecting ? (
        <SelectionBar
          count={selectedRows.length}
          totals={selectedTotals}
          allPicked={allPicked}
          onToggleAll={() => setPicked(allPicked ? new Set() : new Set(rows.map((row) => row.id)))}
          onDone={() => setSelectMode(false)}
        />
      ) : null}

      {filterMounted ? <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        wallets={wallets.filter((w) => !w.archived)}
        onApply={(patch) => {
          setFilterOpen(false);
          apply(patch);
        }}
      /> : null}
    </div>
  );
}


/**
 * Floats above the phone tab bar (and bottom-left of the content on larger
 * screens). Leads with the answer: the net per currency, never combined.
 */
function SelectionBar({
  count,
  totals,
  allPicked,
  onToggleAll,
  onDone,
}: {
  count: number;
  totals: Record<string, number>;
  allPicked: boolean;
  onToggleAll: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("Activity");
  const { currencies } = useAppData();
  const codes = currencies.map((currency) => currency.code).filter((code) => code in totals);
  return (
    <div
      role="region"
      aria-label={t("selectionSummary")}
      className="sticky bottom-[calc(100px+var(--safe-bottom))] z-20 mt-1 flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 shadow-lg md:bottom-4"
    >
      <div aria-live="polite" className="flex min-h-7 flex-wrap items-baseline gap-x-4 gap-y-1">
        {count === 0 ? (
          <p className="text-sm text-muted-foreground">{t("selectHint")}</p>
        ) : codes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("selectNoTotal")}</p>
        ) : (
          codes.map((code) => (
            <Amount key={code} minor={totals[code]} currency={code} sign className="text-xl font-bold" />
          ))
        )}
      </div>
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[13px] text-muted-foreground">{t("selectedCount", { count })}</p>
        <Button variant="ghost" size="sm" onClick={onToggleAll}>
          {allPicked ? t("selectNone") : t("selectAll")}
        </Button>
        <Button size="sm" onClick={onDone}>{t("done")}</Button>
      </div>
    </div>
  );
}

// Search input state must not rerender every loaded transaction on each keystroke.
const ActivityGroups = memo(function ActivityGroups({
  rows,
  hasMore,
  selection,
}: {
  rows: Page["rows"];
  hasMore: boolean;
  selection?: { picked: ReadonlySet<string>; onToggle: (transaction: Transaction) => void };
}) {
  const t = useTranslations("Activity");
  const locale = useLocale();
  const { timezone, currencies } = useAppData();
  const { openDetail } = useComposer();
  const today = todayIn(timezone);
  const groups = useMemo(() => groupByDay(rows), [rows]);
  return <>
    {groups.map((group, index) => {
      const partial = index === groups.length - 1 && hasMore;
      return (
        <section style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${48 + group.rows.length * 72}px` }} key={group.date} aria-label={dayTitle(group.date, today, locale, t)}>
          <div className="sticky top-0 z-10 flex items-baseline justify-between gap-3 bg-background py-2.5 text-[13px] text-muted-foreground">
            <h2 className="text-[14px] font-semibold text-foreground">{dayTitle(group.date, today, locale, t)}</h2>
            {partial ? null : (
              <p className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                {currencies.map((currency) => currency.code)
                  .filter((c) => group.rows.some((r) => r.currency === c))
                  .map((c) => (
                    <Amount key={c} minor={group.totals[c]} currency={c} sign />
                  ))}
              </p>
            )}
          </div>
          <ul className="overflow-hidden rounded-xl border border-border bg-card">
            {group.rows.map((row) => (
              <TransactionRow
                key={row.id}
                transaction={row}
                onOpen={openDetail}
                selection={selection ? { selected: selection.picked.has(row.id), onToggle: selection.onToggle } : undefined}
              />
            ))}
          </ul>
        </section>
      );
    })}
  </>;
});
