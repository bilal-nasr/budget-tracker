"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAppData } from "@/components/providers/app-data";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { SheetShell } from "@/components/ui/sheet-shell";
import { categoryName } from "@/features/categories/catalogue";
import { todayIn } from "@/features/transactions/group";
import type { Filters } from "@/features/transactions/schema";
import { cn } from "@/lib/utils";

type FilterBalance = { id: string; walletId: string; name: string; currency: string };

/** Sentinel for "no category filter"; real ids are UUIDs. */
const ALL = "all";

/** Wallet and currency pills narrow to the matching balances; none picked means no filter. */
function selectedBalanceIds(balances: FilterBalance[], walletId: string | undefined, currency: string | undefined): string | undefined {
  if (!walletId && !currency) return undefined;
  const matching = balances.filter((b) => (!walletId || b.walletId === walletId) && (!currency || b.currency === currency));
  if (matching.length === 0 || matching.length === balances.length) return undefined;
  return matching.map((b) => b.id).join(",");
}

/** Rebuilds the pills from the URL's balance list when it is a plain wallet and/or currency pick. */
function selectionFromIds(balances: FilterBalance[], ids: string | undefined): { walletId?: string; currency?: string } {
  if (!ids) return {};
  const wanted = new Set(ids.split(","));
  const picked = balances.filter((b) => wanted.has(b.id));
  if (picked.length === 0) return {};
  const walletId = picked.every((b) => b.walletId === picked[0].walletId) ? picked[0].walletId : undefined;
  const currency = picked.every((b) => b.currency === picked[0].currency) ? picked[0].currency : undefined;
  return { walletId, currency };
}

export function FilterSheet({
  open,
  onClose,
  filters,
  wallets,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  filters: Filters;
  wallets: FilterBalance[];
  onApply: (patch: Partial<Filters>) => void;
}) {
  const t = useTranslations("Activity");
  const tc = useTranslations("Categories");
  const locale = useLocale();
  const { categories, timezone } = useAppData();
  const initial = selectionFromIds(wallets, filters.balanceId);
  const [walletId, setWalletId] = useState(initial.walletId);
  const [currency, setCurrency] = useState(initial.currency);
  const [categoryId, setCategoryId] = useState(filters.categoryId);
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");
  const today = todayIn(timezone);
  const chip =
    "min-h-11 rounded-full border border-border bg-card px-4 text-sm font-medium aria-checked:border-2 aria-checked:border-foreground aria-checked:bg-accent disabled:opacity-40";

  // Re-sync from the URL each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setWalletId(initial.walletId);
      setCurrency(initial.currency);
      setCategoryId(filters.categoryId);
      setFrom(filters.from ?? "");
      setTo(filters.to ?? "");
    }
  }

  // One pill per wallet and one per currency, in the order the wallets screen shows them.
  const walletPills = [...new Map(wallets.map((w) => [w.walletId, w.name])).entries()];
  const currencyPills = [...new Set(wallets.map((w) => w.currency))];
  const category = categories.find((c) => c.id === categoryId);
  const bad = from !== "" && to !== "" && from > to;
  const label = (c: (typeof categories)[number]) => (
    <>
      <bdi>{categoryName(c, locale)}</bdi>
      {c.archivedAt !== null ? <span className="ms-2 text-sm text-muted-foreground">{tc("archived")}</span> : null}
    </>
  );

  return (
    <SheetShell
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("filters")}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() => onApply({ balanceId: undefined, categoryId: undefined, from: undefined, to: undefined })}
          >
            {t("reset")}
          </Button>
          <Button
            disabled={bad}
            onClick={() => onApply({ balanceId: selectedBalanceIds(wallets, walletId, currency), categoryId, from: from || undefined, to: to || undefined })}
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
            {walletPills.map(([id, name]) => (
              <button key={id} type="button" role="radio" aria-checked={walletId === id} onClick={() => setWalletId(id)} className={chip}>
                <bdi>{name}</bdi>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t("currency")}</legend>
          <div role="radiogroup" aria-label={t("currency")} className="flex flex-wrap gap-2">
            <button type="button" role="radio" aria-checked={!currency} onClick={() => setCurrency(undefined)} className={chip}>
              {t("allCurrencies")}
            </button>
            {currencyPills.map((code) => (
              <button
                key={code}
                type="button"
                role="radio"
                aria-checked={currency === code}
                disabled={walletId !== undefined && !wallets.some((w) => w.walletId === walletId && w.currency === code)}
                onClick={() => setCurrency(code)}
                className={chip}
              >
                <bdi>{code}</bdi>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-2">
          <span id="activity-filter-category" className="text-sm font-medium">{t("category")}</span>
          <Select value={categoryId ?? ALL} onValueChange={(next) => setCategoryId(next && next !== ALL ? (next as string) : undefined)}>
            <SelectTrigger aria-labelledby="activity-filter-category">
              <span className={cn("truncate", !category && "text-muted-foreground")}>
                {category ? label(category) : t("allCategories")}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("allCategories")}</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="truncate">{label(c)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <fieldset className="flex flex-col gap-3">
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
                className={cn("block h-12 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base", bad && "border-over")}
              />
            </label>
          ))}
          {bad ? <p role="alert" className="text-sm text-over">{t("dateOrder")}</p> : null}
        </fieldset>
      </div>
    </SheetShell>
  );
}
