import "server-only";
import { cache } from "react";
import { DEMO_WALLETS } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import type { Wallet } from "./schema";
import { isCurrency, readMinor } from "@/lib/money";

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
    throw new Error("Wallet data unavailable");
  }
  if (balances.error) throw new Error("Wallet balances unavailable");
  const balance = new Map((balances.data ?? []).map((b) => [b.wallet_id as string, readMinor(b.balance_minor)]));
  return wallets.data.map((w) => {
    if (!isCurrency(w.currency)) throw new Error("Unsupported wallet currency");
    return {
    id: w.id,
    name: w.name,
    kind: w.kind,
    currency: w.currency,
    openingBalanceMinor: readMinor(w.opening_balance_minor),
    balanceMinor: balance.get(w.id) ?? readMinor(w.opening_balance_minor),
    position: w.position,
    archived: w.archived_at !== null,
    };
  });
});
