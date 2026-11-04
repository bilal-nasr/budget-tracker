"use client";

import { useId } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import type { Wallet } from "@/features/wallets/schema";

/** Compact wallet selector; full names remain available in its option list. */
export function WalletSelect({ wallets, value, onChange, label, placeholder }: {
  wallets: readonly Wallet[];
  value: string;
  onChange: (walletId: string) => void;
  label: string;
  placeholder: string;
}) {
  const labelId = useId();
  const valueId = useId();
  const selected = wallets.find((wallet) => wallet.id === value);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span id={labelId} className="text-sm font-semibold uppercase">{label}</span>
      <Select value={selected?.id ?? null} onValueChange={(next) => { if (typeof next === "string") onChange(next); }}>
        <SelectTrigger aria-labelledby={`${labelId} ${valueId}`} title={selected ? `${selected.name} · ${selected.currency}` : placeholder}>
          <span id={valueId} className="flex min-w-0 flex-1 items-center gap-1.5">
            <bdi className="min-w-0 flex-1 truncate">{selected?.name ?? placeholder}</bdi>{" "}
            {selected ? <bdi dir="ltr" className="shrink-0 text-sm text-muted-foreground">{selected.currency}</bdi> : null}
          </span>
        </SelectTrigger>
        <SelectContent>
          {wallets.map((wallet) => (
            <SelectItem key={wallet.id} value={wallet.id} label={`${wallet.name} ${wallet.currency}`} aria-label={`${wallet.name} ${wallet.currency}`}>
              <bdi className="min-w-0 flex-1 break-words">{wallet.name}</bdi>
              <bdi dir="ltr" className="shrink-0 text-sm text-muted-foreground">{wallet.currency}</bdi>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
