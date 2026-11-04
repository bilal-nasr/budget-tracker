"use client";

import { Banknote, CreditCard, Landmark, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { useComposer } from "@/components/shell/composer";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { totalsByCurrency, type Wallet } from "@/features/wallets/schema";
import { CURRENCIES } from "@/lib/money";
import { Link } from "@/i18n/navigation";

const ICON = { cash: Banknote, bank: Landmark, card: CreditCard } as const;

/** Wallets grouped by currency, each group with its own total. Currencies are never combined. */
export function WalletsView() {
  const t = useTranslations("Wallets");
  const loans = useTranslations("Loans");
  const payments = useTranslations("PendingPayments");
  const { wallets } = useAppData();
  const { openWallet } = useComposer();
  const active = wallets.filter((w) => !w.archived);
  const archived = wallets.filter((w) => w.archived);
  const [showArchived, setShowArchived] = useState(false);
  const totals = totalsByCurrency(active);
  const groups = CURRENCIES
    .map((currency) => ({ currency, items: active.filter((w) => w.currency === currency) }))
    .filter((g) => g.items.length > 0);

  const archivedSection =
    archived.length > 0 ? (
      <section aria-labelledby="w-archived" className="flex flex-col gap-2">
        <h2 id="w-archived" className="text-[17px] font-semibold">
          <button
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className="inline-flex min-h-11 items-center gap-2 underline underline-offset-4"
          >
            {t("archivedTitle", { count: archived.length })}
          </button>
        </h2>
        {showArchived ? (
          <>
            <p className="text-[13px] text-muted-foreground">{t("archivedHelp")}</p>
            <ul className="overflow-hidden rounded-xl border border-border bg-card">
              {archived.map((wallet) => (
                <WalletRow key={wallet.id} wallet={wallet} onOpen={() => openWallet(wallet)} />
              ))}
            </ul>
          </>
        ) : null}
      </section>
    ) : null;

  if (active.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Link href="/pending-payments" className="inline-flex min-h-11 items-center self-start text-primary underline underline-offset-4">{payments("title")}</Link>
        <Link href="/loans" className="inline-flex min-h-11 items-center self-start text-primary underline underline-offset-4">{loans("title")}</Link>
        <EmptyState
          title={t("emptyTitle")}
          body={archived.length > 0 ? t("emptyArchived") : t("emptyBody")}
          action={<Button onClick={() => openWallet(null)}>{t("addFirst")}</Button>}
        />
        {archivedSection}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/pending-payments" className="inline-flex min-h-11 items-center self-start text-primary underline underline-offset-4">{payments("title")}</Link>
      {groups.map(({ currency, items }) => (
        <section key={currency} aria-labelledby={`w-${currency}`} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id={`w-${currency}`} className="text-[17px] font-semibold">
              <bdi dir="ltr">{currency}</bdi>
            </h2>
            <p className="text-[15px] text-muted-foreground">
              {t("total")} <Amount minor={totals[currency]} currency={currency} className="font-semibold text-foreground" />
            </p>
          </div>
          <ul className="overflow-hidden rounded-xl border border-border bg-card">
            {items.map((wallet) => (
              <WalletRow key={wallet.id} wallet={wallet} onOpen={() => openWallet(wallet)} />
            ))}
          </ul>
        </section>
      ))}
      <Link href="/loans" className="inline-flex min-h-11 items-center self-start text-primary underline underline-offset-4">{loans("title")}</Link>
      <Button variant="outline" onClick={() => openWallet(null)} className="self-start">
        <Plus aria-hidden />
        {t("add")}
      </Button>
      {archivedSection}
    </div>
  );
}

function WalletRow({ wallet, onOpen }: { wallet: Wallet; onOpen: () => void }) {
  const t = useTranslations("Wallets");
  const Icon = ICON[wallet.kind];
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[60px] w-full flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-start hover:bg-accent/50 active:bg-accent"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-secondary text-primary">
          <Icon aria-hidden className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            <bdi>{wallet.name}</bdi>
          </span>
          <span className="block text-[13px] text-muted-foreground">{t(wallet.kind)}</span>
        </span>
        <Amount minor={wallet.balanceMinor} currency={wallet.currency} className="ms-auto max-w-full text-[15px] font-semibold" />
      </button>
    </li>
  );
}
