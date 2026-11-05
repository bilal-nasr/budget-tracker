"use client";

import { useState } from "react";
import { useAppData } from "@/components/providers/app-data";
import type { CurrencyDefinition } from "@/lib/currency";

/** A presentation of one exact balance, never a wallet-level amount. */
export type BalanceChoice = { id: string; walletId: string; name: string; currency: string;
  definition: CurrencyDefinition; balanceMinor: number; position: number; archived: boolean };

export function useRuntimeBalances() {
  const app = useAppData();
  const definition = (code: string): CurrencyDefinition => {
    const found = app.currencyByCode(code);
    if (!found) throw new Error("App currency data unavailable");
    return found;
  };
  const balanceChoiceById = (id: string): BalanceChoice | undefined => {
    const balance = app.balanceById(id);
    const wallet = balance && app.walletById(balance.walletId);
    if (!balance || !wallet) return undefined;
    const currency = definition(balance.currency);
    return { id: balance.id, walletId: wallet.id, name: wallet.name, currency: balance.currency,
      definition: currency, balanceMinor: balance.balanceMinor, position: (app.walletContainers.findIndex((item) => item.id === wallet.id) < 0 ? wallet.position : app.walletContainers.findIndex((item) => item.id === wallet.id)) * app.currencies.length + app.currencies.findIndex((item) => item.code === balance.currency),
      archived: wallet.deleted || wallet.needsAttention || balance.detached || currency.disabled };
  };
  const balanceChoices = app.walletContainers.flatMap((wallet) => wallet.balances.map((balance) => balanceChoiceById(balance.id)!));
  const defaultBalanceId = app.walletContainers[0]?.defaultBalanceId ?? "";
  return { ...app, definition, balanceChoices, balanceChoiceById, defaultBalanceId };
}

/** Reset permanently on denomination/availability changes, never on symbol edits. */
export function useMoneyDraftUnit(definition: CurrencyDefinition | undefined, clear: () => void, available = true) {
  const unit = definition ? `${definition.code}:${definition.decimalPlaces}:${definition.disabled}:${available}` : "unavailable";
  const [previous, setPrevious] = useState(unit);
  if (previous !== unit) { setPrevious(unit); clear(); }
}
