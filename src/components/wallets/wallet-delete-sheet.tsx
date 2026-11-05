"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useAppData } from "@/components/providers/app-data";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { SheetShell } from "@/components/ui/sheet-shell";
import { inspectWalletDeletion, settleAndDeleteWallet } from "@/features/wallets/actions";
import { buildWalletDeletionPlan, resolveWalletSettlements, type WalletDeletionPlan, type WalletSettlement } from "@/features/wallets/deletion";
import type { WalletContainer } from "@/features/wallets/schema";

export function WalletDeleteSheet({ wallet, onClose, onDeleted }: { wallet: WalletContainer; onClose: () => void; onDeleted: () => void }) {
  const t = useTranslations("WalletDeletion");
  const app = useAppData();
  const [preview] = useState(() => {
    try { return buildWalletDeletionPlan(wallet.id, [wallet, ...app.walletContainers.filter((item) => item.id !== wallet.id)], app.currencies, []); }
    catch { return null; }
  });
  const [plan, setPlan] = useState<WalletDeletionPlan | null>(preview);
  const [verified, setVerified] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [attempt, setAttempt] = useState<{ requestId: string; settlements: WalletSettlement[] } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    inspectWalletDeletion(wallet.id).then((result) => {
      if (!active) return;
      if (result.ok) { setPlan(result.plan); setVerified(true); setError(null); }
      else { setVerified(false); setError(t(result.error === "notConfigured" ? "preview" : "inspectionFailed")); }
    }).catch(() => { if (active) { setVerified(false); setError(t("inspectionFailed")); } });
    return () => { active = false; };
  }, [wallet.id, reload, t]);
  const settlements = plan ? resolveWalletSettlements(plan, choices) : null;
  const submit = () => {
    if (pending || !verified || !plan || (!attempt && !settlements)) return;
    const request = attempt ?? { requestId: crypto.randomUUID(), settlements: settlements! };
    setAttempt(request);
    setError(null);
    startTransition(async () => {
      try {
        const result = await settleAndDeleteWallet(request.requestId, wallet.id, request.settlements);
        if (result.ok) { onDeleted(); return; }
        setError(t(result.error === "notConfigured" ? "preview" : ["inUse", "walletNonzero", "settlementMismatch", "deletionConflict", "conflict", "walletUnavailable", "walletDeleted", "walletNeedsAttention", "currencyDisabled", "balanceUnavailable"].includes(result.error) ? "changed" : "failed"));
      } catch { setError(t("failed")); }
    });
  };
  const refresh = () => {
    if (pending) return;
    setVerified(false); setChoices({}); setAttempt(null); setError(null); setReload((value) => value + 1);
  };
  return <SheetShell open dismissible={!pending} onOpenChange={(open) => { if (!open && !pending) onClose(); }} title={t("title", { name: wallet.name })}>
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("help")}</p>
      {wallet.needsAttention ? <p className="text-sm">{t("recovery")}</p> : null}
      {plan?.lines.length === 0 ? <p>{t("zero")}</p> : null}
      {plan?.lines.map((line) => {
        // Counterparts use the shared current wallet order, including reorder previews.
        const order = new Map(app.walletContainers.map((item, index) => [item.id, index]));
        const counterparts = [...line.counterparts].sort((a, b) => (order.get(a.walletId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.walletId) ?? Number.MAX_SAFE_INTEGER));
        return <div key={line.balanceId} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex min-w-0 flex-wrap justify-between gap-2"><bdi>{line.currency.code}</bdi><Amount minor={line.amountMinor} currency={line.currency} className="max-w-full whitespace-normal! break-all font-semibold" /></div>
          <p className="text-sm">{t(line.direction === "out" ? "outgoing" : "incoming")}</p>
          <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">{t(line.direction === "out" ? "destination" : "source", { currency: line.currency.code })}
            <select className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base" value={choices[line.balanceId] ?? ""} disabled={pending || !!attempt}
              onChange={(event) => setChoices((current) => ({ ...current, [line.balanceId]: event.target.value }))}>
              <option value="">{t("choose")}</option>
              {counterparts.map((other) => <option key={other.walletId} value={other.walletId}>{other.walletName}</option>)}
            </select>
          </label>
        </div>;
      })}
      {plan && plan.blockers.length > 0 ? <div className="flex flex-col gap-2 rounded-lg bg-over-soft p-3"><p className="font-medium">{t("blocked")}</p><ul className="list-inside list-disc text-sm">{plan.blockers.map((blocker, index) => <li key={`${blocker.balanceId}-${index}`}>{t(blocker.kind, { name: "name" in blocker ? blocker.name ?? "" : "", currency: "currency" in blocker ? blocker.currency : "" })}</li>)}</ul></div> : null}
      {error ? <p role="alert" className="text-sm text-over-foreground">{error}</p> : null}
      {!verified && !error ? <p role="status">{t("checking")}</p> : null}
      <Button variant="destructive" disabled={pending || !verified || (!attempt && settlements === null)} onClick={submit}>{t(attempt ? "retry" : "confirm")}</Button>
      <Button variant="outline" disabled={pending} onClick={refresh}>{t("reload")}</Button>
      <Button variant="ghost" disabled={pending} onClick={onClose}>{t("cancel")}</Button>
    </div>
  </SheetShell>;
}
