import "server-only";

import { cache } from "react";
import { DEMO_CURRENCIES } from "@/lib/demo-data";
import { indexCurrencies, type CurrencyDefinition } from "@/lib/currency";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { currencyInputSchema } from "./schema";

/** Complete owner catalog, including disabled definitions for exact historical reads.
 * Addition order (created_at, code) also defines balance display order in every wallet.
 */
export const getCurrencies = cache(async (): Promise<CurrencyDefinition[]> => {
  if (!supabaseConfigured()) return DEMO_CURRENCIES;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("currencies")
    .select("code, symbol, decimal_places, disabled_at, first_used_at, created_at")
    .order("created_at")
    .order("code");

  if (error || !data) throw new Error("Currency data unavailable");
  const definitions = data.map((row) => {
    const parsed = currencyInputSchema.safeParse({
      code: row.code,
      symbol: row.symbol,
      decimalPlaces: row.decimal_places,
    });
    if (!parsed.success || parsed.data.code !== row.code || parsed.data.symbol !== row.symbol) {
      throw new Error("Currency data unavailable");
    }
    return {
      ...parsed.data,
      disabled: row.disabled_at !== null,
      firstUsed: row.first_used_at !== null,
    };
  });
  try {
    indexCurrencies(definitions);
  } catch {
    throw new Error("Currency data unavailable");
  }
  return definitions;
});
