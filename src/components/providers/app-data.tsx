"use client";

import { createContext, useContext, useMemo } from "react";
import type { Category } from "@/features/categories/schema";
import type { Wallet } from "@/features/wallets/schema";

type AppData = {
  wallets: Wallet[];
  categories: Category[];
  timezone: string;
  salary: { amountMinor: number; walletId: string } | null;
  usdLbpRate: number | null;
  walletById: (id: string) => Wallet | undefined;
  categoryById: (id: string) => Category | undefined;
};

const Context = createContext<AppData | null>(null);

/** Wallets and categories, loaded once per request by the app layout. */
export function AppDataProvider({
  wallets,
  categories,
  timezone,
  salary,
  usdLbpRate,
  children,
}: {
  wallets: Wallet[];
  categories: Category[];
  timezone: string;
  salary: { amountMinor: number; walletId: string } | null;
  usdLbpRate: number | null;
  children: React.ReactNode;
}) {
  const value = useMemo<AppData>(() => {
    const w = new Map(wallets.map((x) => [x.id, x]));
    const c = new Map(categories.map((x) => [x.id, x]));
    return {
      wallets,
      categories,
      timezone,
      salary,
      usdLbpRate,
      walletById: (id) => w.get(id),
      categoryById: (id) => c.get(id),
    };
  }, [wallets, categories, timezone, salary, usdLbpRate]);
  return <Context value={value}>{children}</Context>;
}

/** Like useAppData, but null outside the app shell (for example during onboarding). */
export function useAppDataOptional(): AppData | null {
  return useContext(Context);
}

export function useAppData(): AppData {
  const value = useContext(Context);
  if (!value) throw new Error("useAppData must be used inside AppDataProvider");
  return value;
}
