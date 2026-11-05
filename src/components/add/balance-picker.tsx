"use client";

import { useId } from "react";
import type { WalletContainer } from "@/features/wallets/schema";
import type { CurrencyDefinition } from "@/lib/currency";

/** Shared wallet order and catalog order in; durable existing balance IDs out. */
export function BalancePicker({
  label, currencyLabel = `${label} currency`, wallets, currencies, value, onChange,
}: {
  label: string;
  currencyLabel?: string;
  wallets: WalletContainer[];
  currencies: CurrencyDefinition[];
  value: string;
  onChange: (id: string) => void;
}) {
  const id = useId();
  const currencyText = currencyLabel;
  const enabled = new Set(currencies.filter((currency) => !currency.disabled).map((currency) => currency.code));
  const available = wallets
    .filter((wallet) => !wallet.deleted && !wallet.needsAttention)
    .map((wallet) => ({
      ...wallet,
      balances: wallet.balances.filter((balance) => !balance.detached && enabled.has(balance.currency)),
    }))
    .filter((wallet) => wallet.balances.length > 0);
  const wallet = available.find((item) => item.balances.some((balance) => balance.id === value));
  const className = "h-12 min-w-0 w-full rounded-lg border border-input bg-card px-3 text-base";

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <select id={id} aria-label={label} className={className} value={wallet?.id ?? ""}
        onChange={(event) => {
          const next = available.find((item) => item.id === event.target.value);
          if (next) onChange(next.balances.find((balance) => balance.id === next.defaultBalanceId)?.id ?? next.balances[0].id);
        }}>
        <option value="" disabled>—</option>
        {available.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <label htmlFor={`${id}-currency`} className="text-sm font-medium">{currencyText}</label>
      <select id={`${id}-currency`} aria-label={currencyText} className={className} value={value}
        disabled={!wallet} onChange={(event) => onChange(event.target.value)}>
        {!wallet ? <option value="" /> : null}
        {currencies.filter((currency) => !currency.disabled).flatMap((currency) => {
          const balance = wallet?.balances.find((item) => item.currency === currency.code);
          return balance ? [<option key={balance.id} value={balance.id}>{balance.currency}</option>] : [];
        })}
      </select>
    </div>
  );
}
