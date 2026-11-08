"use client";

import { useOptimistic, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { Check, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useRuntimeBalances } from "@/components/add/runtime-balances";
import { TileBar } from "@/components/budget/tile-bar";
import { Amount } from "@/components/money/amount";
import { CurrencyTabs } from "@/components/shell/currency-tabs";
import { EmptyState } from "@/components/shell/empty-state";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";
import { Button } from "@/components/ui/button";
import { createItem, deleteItem } from "@/features/items/actions";
import { itemErrorKey } from "@/features/items/errors";
import { MAX_BUY_ITEMS, type ItemCreateInput, type ShoppingItem } from "@/features/items/schema";
import { sumMinor } from "@/lib/money";
import { Link } from "@/i18n/navigation";
import { AddItemForm } from "./add-item-form";

// Sheets load on first open; the list renders without their code.
const ItemSheet = dynamic(() => import("./item-sheet").then((m) => m.ItemSheet));
const BuySheet = dynamic(() => import("./buy-sheet").then((m) => m.BuySheet));
const ConfirmSheet = dynamic(() => import("@/components/ui/confirm-sheet").then((m) => m.ConfirmSheet));

type SheetState = { mode: "edit" | "buy" | "delete"; ids: string[] } | null;

function totalOf(items: readonly ShoppingItem[]): number | null {
  try { return sumMinor(items.map((item) => item.priceMinor)); } catch { return null; }
}

/**
 * Price things, tick some to total just those, and say "I bought this" to put them in
 * Activity. Every total is per currency: tabs pick the currency, nothing is ever mixed.
 */
export function ItemsView({ items }: { items: ShoppingItem[] }) {
  const t = useTranslations("Items");
  const locale = useLocale();
  const { enabledCurrencies: catalog, defaultCurrency } = useRuntimeBalances();
  const currencies = [...catalog].sort((a, b) => Number(b.code === defaultCurrency) - Number(a.code === defaultCurrency));
  const [chosen, setChosen] = useState<string | null>(null);
  const currency = currencies.find((entry) => entry.code === chosen) ?? currencies[0];
  const code = currency?.code ?? "";
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<SheetState>(null);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [list, addOptimistic] = useOptimistic(items, (state, added: ShoppingItem) => [added, ...state]);

  const here = list.filter((item) => item.currency === code);
  const toBuy = here.filter((item) => !item.boughtOn);
  const bought = here.filter((item) => item.boughtOn);
  const picked = toBuy.filter((item) => selected.has(item.id));
  const total = totalOf(toBuy);
  const pickedTotal = totalOf(picked);
  const allPicked = toBuy.length > 0 && picked.length === toBuy.length;
  const target = sheet ? list.filter((item) => sheet.ids.includes(item.id)) : [];

  const formatDate = (date: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-LB-u-nu-latn" : "en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  const close = () => { setSheet(null); setDeleteError(null); };
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  const switchCurrency = (next: string) => { setChosen(next); setSelected(new Set()); };
  const add = (item: ShoppingItem, input: ItemCreateInput) => { addOptimistic(item); return createItem(input); };
  const remove = () => {
    const item = target[0];
    if (!item || deleting) return;
    startDelete(async () => {
      try {
        const result = await deleteItem(item.id);
        if (!result.ok) { setDeleteError(t(itemErrorKey(result.error))); return; }
        setSelected((current) => { const next = new Set(current); next.delete(item.id); return next; });
        close(); toast(t("deleted"));
      } catch { setDeleteError(t("errorFailed")); }
    });
  };

  return <>
    <ScreenHeader title={t("title")}>
      {currencies.length > 1 ? <CurrencyTabs className="mb-1" currencies={currencies} value={code} onChange={switchCurrency} label={t("displayCurrency")} /> : null}
      <p className="mt-1 flex flex-wrap justify-between gap-x-3 text-[13px] text-shell-muted"><span>{t("totalLabel")}</span><span>{t("count", { count: toBuy.length })}</span></p>
      {total === null ? <p role="status" className="text-[15px]">{t("totalsUnavailable")}</p>
        : <Amount minor={total} currency={code} className="block text-[40px] leading-[1.1] font-bold tracking-[-0.025em] text-shell-foreground" />}
      <div className="mt-3 flex flex-col gap-2">
        <TileBar tone="shell" value={total && pickedTotal ? Math.min(1, pickedTotal / total) : 0} label={t("selectedShare")} />
        <p className="flex min-h-5 flex-wrap items-baseline justify-between gap-x-3 text-[15px] text-shell-foreground">
          <span>{t("selectedLabel", { count: picked.length })}</span>
          {pickedTotal === null ? null : <Amount minor={pickedTotal} currency={code} className="font-semibold" />}
        </p>
      </div>
    </ScreenHeader>
    <PageBody>
      <p className="text-[15px] text-muted-foreground">{t("help")}</p>
      <AddItemForm key={code} currency={code} onAdd={add} />
      {!here.length ? <EmptyState title={t("emptyTitle")} body={t("emptyBody")} /> : null}
      {toBuy.length ? <section aria-label={t("toBuy")} className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold">{t("toBuy")}</h2>
          <Button variant="ghost" size="sm" onClick={() => setSelected(allPicked ? new Set() : new Set(toBuy.map((item) => item.id)))}>{t(allPicked ? "clearSelection" : "selectAll")}</Button>
        </div>
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {toBuy.map((item) => {
            const on = selected.has(item.id);
            return <li key={item.id} className={`flex items-stretch border-b border-border last:border-b-0 ${on ? "bg-secondary" : ""}`}>
              <label className="grid w-12 shrink-0 cursor-pointer place-items-center">
                <input type="checkbox" checked={on} onChange={() => toggle(item.id)} aria-label={t("selectRow", { name: item.name })} className="size-5 accent-primary" />
              </label>
              <button type="button" aria-label={t("editNamed", { name: item.name })} onClick={() => setSheet({ mode: "edit", ids: [item.id] })}
                className="min-w-0 flex-1 py-3 pe-2 text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                <span className="block break-words font-medium"><bdi>{item.name}</bdi></span>
                <Amount minor={item.priceMinor} currency={item.currency} className="text-[15px] font-semibold" />
              </button>
              <div className="flex shrink-0 items-center pe-3">
                <Button variant="outline" size="sm" aria-label={t("boughtNamed", { name: item.name })} onClick={() => setSheet({ mode: "buy", ids: [item.id] })}>{t("bought")}</Button>
              </div>
            </li>;
          })}
        </ul>
      </section> : null}
      {picked.length ? <div className="sticky bottom-[calc(124px+var(--safe-bottom))] z-20 flex items-center gap-2 rounded-xl border border-border bg-card p-2 ps-3.5 md:bottom-4">
        <p className="min-w-0 flex-1 text-sm">
          <span className="block text-muted-foreground">{t("selectedLabel", { count: picked.length })}</span>
          {pickedTotal === null ? null : <Amount minor={pickedTotal} currency={code} className="text-[17px] font-semibold" />}
        </p>
        <Button variant="ghost" size="icon" aria-label={t("clearSelection")} onClick={() => setSelected(new Set())}><X aria-hidden /></Button>
        <Button disabled={picked.length > MAX_BUY_ITEMS} onClick={() => setSheet({ mode: "buy", ids: picked.map((item) => item.id) })}><Check aria-hidden />{t("buySelected", { count: picked.length })}</Button>
      </div> : null}
      {picked.length > MAX_BUY_ITEMS ? <p role="status" className="text-sm">{t("tooMany", { max: MAX_BUY_ITEMS })}</p> : null}
      {bought.length ? <details>
        <summary className="min-h-11 cursor-pointer py-3 text-[17px] font-semibold">{t("completed", { count: bought.length })}</summary>
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {bought.map((item) => <li key={item.id} className="flex items-center gap-3 border-b border-border ps-3.5 last:border-b-0">
            <Check aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 py-3">
              <span className="block break-words font-medium"><bdi>{item.name}</bdi></span>
              <span className="block text-[13px] text-muted-foreground">{t("boughtOn", { date: formatDate(item.boughtOn!) })}</span>
            </span>
            <Amount minor={item.priceMinor} currency={item.currency} className="text-[15px]" />
            <Button variant="ghost" size="icon" aria-label={`${t("delete")}: ${item.name}`} onClick={() => setSheet({ mode: "delete", ids: [item.id] })}><Trash2 aria-hidden /></Button>
          </li>)}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">{t("boughtHelp")} <Link href="/activity" className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">{t("activity")}</Link></p>
      </details> : null}
    </PageBody>
    {target[0] && sheet?.mode === "edit" ? <ItemSheet key={target[0].id} item={target[0]} onClose={close} onDelete={() => setSheet({ mode: "delete", ids: [target[0].id] })} /> : null}
    {target.length && sheet?.mode === "buy" ? <BuySheet key={sheet.ids.join()} items={target} onClose={close} onDone={() => setSelected(new Set())} /> : null}
    {target[0] && sheet?.mode === "delete" ? <ConfirmSheet open tone="danger" title={t("confirmDelete")} onOpenChange={(open) => !open && !deleting && close()} confirmLabel={t("delete")} cancelLabel={t("cancel")} pending={deleting} onConfirm={remove}>
      <p><bdi>{target[0].name}</bdi></p><p>{t("deleteHelp")}</p>{deleteError ? <p role="alert">{deleteError}</p> : null}
    </ConfirmSheet> : null}
  </>;
}
