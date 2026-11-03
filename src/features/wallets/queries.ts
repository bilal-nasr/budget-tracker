import "server-only";
import { cache } from "react";
import { DEMO_WALLETS } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import type { Wallet } from "./schema";

/** Active and archived wallets with their current balance, in display order. */
export const getWallets = cache(async (): Promise<Wallet[]> => {
  if (!supabaseConfigured()) return DEMO_WALLETS;
  const supabase = await createClient();
  const [wallets, balances] = await Promise.all([
    supabase
      .from("wallets")
      .select("id, name, kind, currency, opening_balance_minor, position, archived_at")
      .order("position")
      .order("created_at"),
    supabase.from("wallet_balances").select("wallet_id, balance_minor"),
  ]);
  if (wallets.error || !wallets.data) {
    console.error("[getWallets]", wallets.error?.message);
    return [];
  }
  if (balances.error) console.error("[getWallets balances]", balances.error.message);
  const balance = new Map((balances.data ?? []).map((b) => [b.wallet_id as string, Number(b.balance_minor)]));
  return wallets.data.map((w) => ({
    id: w.id,
    name: w.name,
    kind: w.kind,
    currency: w.currency,
    openingBalanceMinor: Number(w.opening_balance_minor),
    balanceMinor: balance.get(w.id) ?? Number(w.opening_balance_minor),
    position: w.position,
    archived: w.archived_at !== null,
  }));
});
