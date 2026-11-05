"use client";

import { Banknote, CreditCard, Landmark, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { useComposer } from "@/components/shell/composer";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import type { WalletContainer } from "@/features/wallets/schema";
import { Link } from "@/i18n/navigation";
import { CurrencySelector } from "./currency-selector";

const ICON = { cash: Banknote, bank: Landmark, card: CreditCard } as const;

/** Display selection never changes wallet defaults or creates balance rows. */
export function WalletsView() {
  const t = useTranslations("Wallets");
  const nav = useTranslations("Nav");
  const loans = useTranslations("Loans");
  const payments = useTranslations("PendingPayments");
  const { walletContainers: wallets, needsAttentionWallets, enabledCurrencies } = useAppData();
  const { openWallet } = useComposer();
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const currency = enabledCurrencies.find((item) => item.code === selectedCode) ?? enabledCurrencies[0];
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {currency ? <CurrencySelector currencies={enabledCurrencies} value={currency.code} onChange={setSelectedCode} label={t("displayCurrency")} /> : null}
      <p className="text-sm text-muted-foreground">{t("currencyViewHelp")}</p>
      {wallets.length === 0 ? <EmptyState title={t("emptyTitle")} body={t("emptyBody")}
        action={<Button onClick={() => openWallet(null)}>{t("addFirst")}</Button>} /> : <>
        <ul aria-label={nav("wallets")} className="overflow-hidden rounded-xl border border-border bg-card">
          {wallets.map((wallet) => <WalletRow key={wallet.id} wallet={wallet} currency={currency?.code} onOpen={() => openWallet(wallet)} />)}
        </ul>
        <Button variant="outline" onClick={() => openWallet(null)} className="self-start"><Plus aria-hidden />{t("add")}</Button>
      </>}
      {needsAttentionWallets.length > 0 ? <section aria-labelledby="w-attention" className="flex min-w-0 flex-col gap-2">
        <h2 id="w-attention" className="text-[17px] font-semibold">{t("needsAttention")}</h2>
        <p className="text-sm text-muted-foreground">{t("needsAttentionHelp")}</p>
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {needsAttentionWallets.map((wallet) => <WalletRow key={wallet.id} wallet={wallet} currency={currency?.code} onOpen={() => openWallet(wallet)} />)}
        </ul>
      </section> : null}
      <div className="flex flex-wrap gap-x-5">
        <Link href="/pending-payments" className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">{payments("title")}</Link>
        <Link href="/loans" className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">{loans("title")}</Link>
      </div>
    </div>
  );
}

function WalletRow({ wallet, currency, onOpen }: { wallet: WalletContainer; currency?: string; onOpen: () => void }) {
  const t = useTranslations("Wallets");
  const Icon = ICON[wallet.kind];
  const balance = wallet.balances.find((item) => item.currency === currency);
  const defaultBalance = wallet.balances.find((item) => item.id === wallet.defaultBalanceId);
  return <li className="min-w-0 border-b border-border last:border-b-0">
    <button type="button" onClick={onOpen} className="flex min-h-[76px] w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3 text-start hover:bg-accent/50 active:bg-accent">
      <span className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-secondary text-primary"><Icon aria-hidden className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium"><bdi>{wallet.name}</bdi></span>
        <span className="block text-[13px] text-muted-foreground">{t(wallet.kind)}</span>
        <span className="block text-[13px] text-muted-foreground">{t("defaultCurrency")}: <bdi dir="ltr">{defaultBalance?.currency ?? "—"}</bdi></span>
      </span>
      {balance ? <Amount minor={balance.balanceMinor} currency={balance.currency} className="ms-auto max-w-full whitespace-normal! break-all text-[15px] font-semibold" /> : <span role="status">{t("balanceUnavailable")}</span>}
    </button>
  </li>;
}
