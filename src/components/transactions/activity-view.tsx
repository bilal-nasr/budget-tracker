"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { Search, SlidersHorizontal, Tag, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { SelectionBar, SelectToggle } from "@/components/selection/selection-bar";
import { useLongPress } from "@/components/selection/use-long-press";
import { useSelection } from "@/components/selection/use-selection";
import { useComposer } from "@/components/shell/composer";
import { EmptyState } from "@/components/shell/empty-state";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "@/i18n/navigation";
import { categoryOptions } from "@/features/categories/catalogue";
import { loadTransactions } from "@/features/transactions/actions";
import { deleteTransactions, restoreTransactions, setTransactionsCategory } from "@/features/transactions/bulk-actions";
import { BULK_LIMIT, canBulkDelete, canBulkRecategorize } from "@/features/transactions/bulk-schema";
import { addDays, groupByDay, sumSelected, todayIn } from "@/features/transactions/group";
import type { Cursor, Filters, Page, Transaction } from "@/features/transactions/schema";

// The filter sheet (and the drawer it needs) loads on first open, then stays
// mounted for its exit animation.
const FilterSheet = dynamic(() => import("./activity-filter-sheet").then((m) => m.FilterSheet));
// Bulk sheets load on first use; the list renders without their code.
const ConfirmSheet = dynamic(() => import("@/components/ui/confirm-sheet").then((m) => m.ConfirmSheet));
const BulkCategorySheet = dynamic(() => import("./bulk-category-sheet").then((m) => m.BulkCategorySheet));

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
  const td = useTranslations("Detail");
  const tb = useTranslations("Breakdown");
  const tc = useTranslations("Cashier");
  const ti = useTranslations("Installments");
  const router = useRouter();
  const pathname = usePathname();
  const { walletContainers, categories, balanceById, walletById, currencyByCode } = useAppData();
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

  // Select mode: tap rows to add them up, then act on them together. Derived from the loaded
  // rows, so a row that was deleted or filtered out never counts.
  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const selection = useSelection(rowIds);
  const { picked, toggle: toggleId, start: startSelecting } = selection;
  const selectedRows = useMemo(() => rows.filter((row) => picked.has(row.id)), [rows, picked]);
  const selectedTotals = useMemo(() => sumSelected(selectedRows), [selectedRows]);
  const toggle = useCallback((transaction: Transaction) => toggleId(transaction.id), [toggleId]);
  const startWith = useCallback((transaction: Transaction) => startSelecting(transaction.id), [startSelecting]);

  // A row whose wallet was deleted, needs attention, or whose currency is switched off is kept
  // as history: the single-row sheet offers no Delete or Edit for it, so neither does a batch.
  const historyLocked = (row: Transaction) =>
    Boolean(currencyByCode(row.currency)?.disabled) ||
    [row.balanceId, row.toBalanceId, ...(row.settlement?.changes.map((change) => change.balanceId) ?? [])]
      .filter((id): id is string => !!id)
      .some((id) => {
        const balance = balanceById(id);
        const owner = balance ? walletById(balance.walletId) : undefined;
        return balance ? Boolean(balance.detached || !owner || owner.deleted || owner.needsAttention || currencyByCode(balance.currency)?.disabled) : true;
      });
  const deletable = selectedRows.filter((row) => canBulkDelete(row) && !historyLocked(row));
  const recategorizable = selectedRows.filter((row) => canBulkRecategorize(row) && !historyLocked(row));
  const recategorizeKinds = new Set(recategorizable.map((row) => row.kind));

  const [bulk, setBulk] = useState<"delete" | "category" | null>(null);
  const [bulkMounted, setBulkMounted] = useState<{ delete: boolean; category: boolean }>({ delete: false, category: false });
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkPending, startBulk] = useTransition();
  // What the open sheet talks about, frozen when it opens so its words do not change while it
  // slides away after the selection has been cleared.
  const [bulkInfo, setBulkInfo] = useState<{ count: number; skipped: number; kind: "expense" | "income" }>({ count: 0, skipped: 0, kind: "expense" });
  const openBulk = (which: "delete" | "category") => {
    const eligible = which === "delete" ? deletable : recategorizable;
    setBulkInfo({ count: eligible.length, skipped: selectedRows.length - eligible.length, kind: recategorizable[0]?.kind === "income" ? "income" : "expense" });
    setBulkMounted((mounted) => ({ ...mounted, [which]: true }));
    setBulkError(null);
    setBulk(which);
  };
  const bulkErrorText = (error: string) =>
    error === "notConfigured" ? td("errorPreview")
      : error === "conflict" ? t("bulkConflict")
      : error === "managedTransaction" ? t("bulkManaged")
      : error === "categoryUnavailable" ? t("bulkCategoryUnavailable")
      : error === "walletUnavailable" ? t("bulkWalletUnavailable")
      : t("bulkFailed");

  const askDelete = () => {
    if (deletable.length === 0) { toast(t("bulkNoneDeletable")); return; }
    if (deletable.length > BULK_LIMIT) { toast(t("bulkTooMany", { max: BULK_LIMIT })); return; }
    openBulk("delete");
  };
  const askCategory = () => {
    if (recategorizable.length === 0) { toast(t("bulkNoneCategory")); return; }
    if (recategorizeKinds.size > 1) { toast(t("bulkMixedKinds")); return; }
    if (recategorizable.length > BULK_LIMIT) { toast(t("bulkTooMany", { max: BULK_LIMIT })); return; }
    openBulk("category");
  };
  const confirmDelete = () => {
    if (bulkPending || deletable.length === 0) return;
    const items = deletable.map((row) => ({ id: row.id, revision: row.revision }));
    startBulk(async () => {
      const result = await deleteTransactions(items);
      if (!result.ok) { setBulkError(bulkErrorText(result.error)); return; }
      setBulk(null);
      selection.stop();
      toast(t("bulkDeleted", { count: result.items.length }), {
        action: {
          label: td("undo"),
          onClick: async () => {
            const restored = await restoreTransactions(result.items);
            if (restored.ok) return;
            if (restored.error === "conflict") toast.error(t("bulkUndoConflict"), { action: { label: tb("reload"), onClick: () => window.location.reload() } });
            else toast.error(restored.error === "walletUnavailable" ? tc("walletUnavailable") : restored.error === "exceedsRemaining" ? ti("restoreOvercap") : t("bulkUndoFailed"));
          },
        },
      });
    });
  };
  const applyCategory = (categoryId: string) => {
    if (bulkPending || recategorizable.length === 0 || recategorizeKinds.size !== 1) return;
    const items = recategorizable.map((row) => ({ id: row.id, revision: row.revision }));
    startBulk(async () => {
      const result = await setTransactionsCategory(items, categoryId);
      if (!result.ok) { setBulkError(bulkErrorText(result.error)); return; }
      setBulk(null);
      selection.stop();
      toast(t("bulkCategoryChanged", { count: result.items.length }));
    });
  };

  const kind = filters.kind ?? "all";
  const extraCount = [filters.balanceId, filters.categoryId, filters.from, filters.to].filter(Boolean).length;
  const filtered = Boolean(filters.q || filters.kind || extraCount);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <label className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-input bg-card px-3.5 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
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
        <SelectToggle
          selecting={selection.selecting}
          label={t("select")}
          className="size-12"
          onToggle={() => (selection.selecting ? selection.stop() : selection.start())}
        />
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
          <ActivityGroups rows={rows} hasMore={next !== null} selection={selection.selecting ? { picked, onToggle: toggle } : undefined} onLongPress={selection.selecting ? undefined : startWith} />
          <div ref={sentinel} aria-hidden className="h-px" />
          {next ? (
            <div className="flex flex-col items-center gap-2 py-4">
              {loadFailed ? <p role="alert" className="text-sm text-over">{t("loadFailed")}</p> : null}
              <Button variant="outline" onClick={loadMore} loading={loading}>
                {loading ? t("loading") : t("loadMore")}
              </Button>
            </div>
          ) : (
            <p className="py-4 text-center text-[13px] text-muted-foreground">{t("end")}</p>
          )}
        </div>
      )}

      {selection.selecting ? (
        <SelectionBar
          label={t("selectionSummary")}
          count={selection.count}
          allPicked={selection.allPicked}
          onToggleAll={selection.toggleAll}
          onDone={selection.stop}
          summary={<SelectionTotals count={selection.count} totals={selectedTotals} />}
        >
          <Button variant="outline" disabled={selection.count === 0} onClick={askCategory}>
            <Tag aria-hidden />
            {t("bulkCategory")}
          </Button>
          <Button variant="destructive" disabled={selection.count === 0} onClick={askDelete}>
            <Trash2 aria-hidden />
            {t("bulkDelete")}
          </Button>
        </SelectionBar>
      ) : null}

      {bulkMounted.delete ? <ConfirmSheet
        open={bulk === "delete"}
        onOpenChange={(open) => { if (!open && !bulkPending) setBulk(null); }}
        title={t("bulkDeleteTitle", { count: bulkInfo.count })}
        confirmLabel={t("bulkDelete")}
        cancelLabel={t("bulkCancel")}
        pending={bulkPending}
        tone="danger"
        onConfirm={confirmDelete}
      >
        <p>{t("bulkDeleteBody")}</p>
        {bulkInfo.skipped > 0 ? <p className="text-muted-foreground">{t("bulkDeleteSkipped", { count: bulkInfo.skipped })}</p> : null}
        {bulkError ? <p role="alert" className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm">{bulkError}</p> : null}
      </ConfirmSheet> : null}

      {bulkMounted.category ? <BulkCategorySheet
        open={bulk === "category"}
        onOpenChange={(open) => { if (!open) setBulk(null); }}
        categories={categoryOptions(categories, bulkInfo.kind)}
        count={bulkInfo.count}
        skipped={bulkInfo.skipped}
        pending={bulkPending}
        error={bulkError}
        onApply={applyCategory}
      /> : null}

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


/** Leads the selection bar with the answer: the net per currency, never combined. */
function SelectionTotals({ count, totals }: { count: number; totals: Record<string, number> }) {
  const t = useTranslations("Activity");
  const { currencies } = useAppData();
  const codes = currencies.map((currency) => currency.code).filter((code) => code in totals);
  return (
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
  );
}

// Search input state must not rerender every loaded transaction on each keystroke.
const ActivityGroups = memo(function ActivityGroups({
  rows,
  hasMore,
  selection,
  onLongPress,
}: {
  rows: Page["rows"];
  hasMore: boolean;
  selection?: { picked: ReadonlySet<string>; onToggle: (transaction: Transaction) => void };
  /** Press-and-hold shortcut into select mode; the Select button is the visible path. */
  onLongPress?: (transaction: Transaction) => void;
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
          <DayRows rows={group.rows} onOpen={openDetail} selection={selection} onLongPress={onLongPress} />
        </section>
      );
    })}
  </>;
});

/**
 * One day's rows. Holding a row starts select mode with that row ticked. The hold handlers stay
 * attached in select mode too (where a hold does nothing), so the tap that ends the hold is
 * still swallowed instead of unticking the row it just ticked.
 */
function DayRows({ rows, onOpen, selection, onLongPress }: {
  rows: Transaction[];
  onOpen: (transaction: Transaction) => void;
  selection?: { picked: ReadonlySet<string>; onToggle: (transaction: Transaction) => void };
  onLongPress?: (transaction: Transaction) => void;
}) {
  const hold = useLongPress((index) => {
    const row = rows[index];
    if (row && onLongPress) onLongPress(row);
  });
  return (
    <ul className="overflow-hidden rounded-xl border border-border bg-card" {...hold}>
      {rows.map((row) => (
        <TransactionRow
          key={row.id}
          transaction={row}
          onOpen={onOpen}
          selection={selection ? { selected: selection.picked.has(row.id), onToggle: selection.onToggle } : undefined}
        />
      ))}
    </ul>
  );
}
