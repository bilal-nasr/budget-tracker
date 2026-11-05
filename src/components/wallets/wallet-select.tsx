"use client";

import { useId } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

/** Compact wallet selector; full names remain available in its option list. */
export function WalletSelect({ wallets, value, onChange, label, placeholder }: {
  wallets: readonly { id: string; name: string;  }[];
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
        <SelectTrigger aria-labelledby={`${labelId} ${valueId}`} title={selected?.name ?? placeholder}>
          <span id={valueId} className="flex min-w-0 flex-1 items-center gap-1.5">
            <bdi className="min-w-0 flex-1 truncate">{selected?.name ?? placeholder}</bdi>{" "}

          </span>
        </SelectTrigger>
        <SelectContent>
          {wallets.map((wallet) => (
            <SelectItem key={wallet.id} value={wallet.id} label={wallet.name} aria-label={wallet.name}>
              <bdi className="min-w-0 flex-1 break-words">{wallet.name}</bdi>

            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
