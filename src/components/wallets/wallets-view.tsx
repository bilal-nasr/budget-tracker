"use client";

import { Banknote, CreditCard, Info, Landmark, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Amount } from "@/components/money/amount";
import { useAppData } from "@/components/providers/app-data";
import { useComposer } from "@/components/shell/composer";
import { CurrencyTabs } from "@/components/shell/currency-tabs";
import { EmptyState } from "@/components/shell/empty-state";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";
import { Button } from "@/components/ui/button";
import type { WalletContainer } from "@/features/wallets/schema";
import { WalletReorder } from "./wallet-reorder";

const ICON = { cash: Banknote, bank: Landmark, card: CreditCard } as const;

/** Display selection never changes wallet defaults or creates balance rows. */
export function WalletsView({ commitments }: { commitments?: React.ReactNode }) {
  const t = useTranslations("Wallets");
  const nav = useTranslations("Nav");
  const { walletContainers: wallets, needsAttentionWallets, enabledCurrencies: catalog, defaultCurrency } = useAppData();
  // The default currency leads the dropdown and is shown first.
  const enabledCurrencies = [...catalog].sort((a, b) => Number(b.code === defaultCurrency) - Number(a.code === defaultCurrency));
  const { openWallet } = useComposer();
  const [showInfo, setShowInfo] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const currency = enabledCurrencies.find((item) => item.code === selectedCode) ?? enabledCurrencies[0];
  return (<>
    <ScreenHeader title={nav("wallets")}>
      <div className="mt-1 flex items-center gap-1">
        {currency && enabledCurrencies.length > 1 ? <CurrencyTabs className="min-w-0 flex-1" currencies={enabledCurrencies} value={currency.code} onChange={setSelectedCode} label={t("displayCurrency")} /> : <span className="flex-1" />}
        <button type="button" aria-label={t("moreInfo")} aria-expanded={showInfo} onClick={() => setShowInfo((v) => !v)}
          className="grid size-11 shrink-0 place-items-center rounded-full text-shell-muted hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-ring"><Info aria-hidden className="size-5" /></button>
      </div>
    </ScreenHeader>
    <PageBody>
    <div className="flex min-w-0 flex-col gap-6">
      {showInfo ? <p className="text-sm text-muted-foreground">{t("currencyViewHelp")}</p> : null}
      {wallets.length === 0 ? <EmptyState title={t("emptyTitle")} body={t("emptyBody")}
        action={<Button onClick={() => openWallet(null)}>{t("addFirst")}</Button>} /> : <>
        <WalletReorder showHelp={showInfo}>{(wallet) => <WalletRow wallet={wallet} currency={currency?.code} onOpen={() => openWallet(wallet)} />}</WalletReorder>
        <Button variant="outline" onClick={() => openWallet(null)} className="self-start"><Plus aria-hidden />{t("add")}</Button>
      </>}
      {needsAttentionWallets.length > 0 ? <section aria-labelledby="w-attention" className="flex min-w-0 flex-col gap-2">
        <h2 id="w-attention" className="text-[17px] font-semibold">{t("needsAttention")}</h2>
        <p className="text-sm text-muted-foreground">{t("needsAttentionHelp")}</p>
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {needsAttentionWallets.map((wallet) => <li key={wallet.id} className="min-w-0 border-b border-border last:border-b-0"><WalletRow wallet={wallet} currency={currency?.code} onOpen={() => openWallet(wallet)} /></li>)}
        </ul>
      </section> : null}
      {commitments}
    </div>
    </PageBody>
  </>);
}

function WalletRow({ wallet, currency, onOpen }: { wallet: WalletContainer; currency?: string; onOpen: () => void }) {
  const t = useTranslations("Wallets");
  const Icon = ICON[wallet.kind];
  const balance = wallet.balances.find((item) => item.currency === currency);
  const defaultBalance = wallet.balances.find((item) => item.id === wallet.defaultBalanceId);
  return <button type="button" aria-label={t("editNamed", { name: wallet.name })} onClick={onOpen} className="flex min-h-[76px] w-full min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3 text-start hover:bg-accent/50 active:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
      <span className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-secondary text-primary"><Icon aria-hidden className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium"><bdi>{wallet.name}</bdi></span>
        <span className="block text-[13px] text-muted-foreground">{t(wallet.kind)}</span>
        <span className="block text-[13px] text-muted-foreground">{t("defaultCurrency")}: <bdi dir="ltr">{defaultBalance?.currency ?? "—"}</bdi></span>
      </span>
      {balance ? <Amount minor={balance.balanceMinor} currency={balance.currency} className="ms-auto max-w-full whitespace-normal! break-all text-[15px] font-semibold" /> : <span role="status">{t("balanceUnavailable")}</span>}
    </button>;
}
