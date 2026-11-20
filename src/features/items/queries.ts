import "server-only";
import { currencyCodeSchema } from "@/features/currencies/schema";
import { readMinor } from "@/lib/money";
import { readAllByKey } from "@/lib/supabase/read-all";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { createClient } from "@/lib/supabase/server";
import type { ShoppingItem } from "./schema";

type Row = { id: string; name: string; currency: string; price_minor: number | string; quantity: number; created_at: string; bought_on: string | null; transaction_id: string | null };

/** Preview mode (no database) shows a few synthetic items so the screen can be seen; two of them have a quantity. */
const DEMO: ShoppingItem[] = [
  { id: "ac000000-0000-4000-8000-000000000001", name: "Olive oil, 1 L", currency: "USD", priceMinor: 1250, quantity: 1, createdAt: "2026-11-03T09:00:00Z", boughtOn: null, transactionId: null },
  { id: "ac000000-0000-4000-8000-000000000002", name: "Phone charger", currency: "USD", priceMinor: 1800, quantity: 1, createdAt: "2026-11-03T08:00:00Z", boughtOn: null, transactionId: null },
  { id: "ac000000-0000-4000-8000-000000000003", name: "Notebook", currency: "USD", priceMinor: 150, quantity: 3, createdAt: "2026-11-02T08:00:00Z", boughtOn: null, transactionId: null },
  { id: "ac000000-0000-4000-8000-000000000004", name: "Bread", currency: "LBP", priceMinor: 45000, quantity: 2, createdAt: "2026-11-02T07:00:00Z", boughtOn: null, transactionId: null },
  { id: "ac000000-0000-4000-8000-000000000005", name: "Coffee beans", currency: "USD", priceMinor: 900, quantity: 1, createdAt: "2026-11-01T07:00:00Z", boughtOn: "2026-11-02", transactionId: "ac000000-0000-4000-8000-0000000000f1" },
];

/** Newest first. Bought status comes from the view, so a deleted purchase returns its items. */
export async function getShoppingItems(): Promise<ShoppingItem[]> {
  if (!supabaseConfigured()) return DEMO;
  const db = await createClient();
  const rows = await readAllByKey<Row>(
    (after, limit) => {
      let query = db.from("shopping_item_status").select("id,name,currency,price_minor,quantity,created_at,bought_on,transaction_id").order("id").limit(limit);
      if (after) query = query.gt("id", after);
      return query;
    },
    (row) => row.id,
    "Items unavailable",
  );
  return rows
    .map((row) => {
      if (!currencyCodeSchema.safeParse(row.currency).success) throw new Error("Invalid item currency");
      if (!Number.isSafeInteger(row.quantity) || row.quantity < 1) throw new Error("Invalid item quantity");
      return { id: row.id, name: row.name, currency: row.currency, priceMinor: readMinor(row.price_minor), quantity: row.quantity, createdAt: row.created_at, boughtOn: row.bought_on, transactionId: row.transaction_id };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id.localeCompare(b.id)));
}
