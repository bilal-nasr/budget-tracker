import "server-only";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { readAllByKey } from "@/lib/supabase/read-all";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/supabase/user";

/** Just enough to pick a folder: no rows, members or totals are read. */
export type InvoiceFolderChoice = { id: string; name: string };

type Row = { id: string; name: string; created_at: string };

/** Preview mode (no database) offers the same synthetic folders as the Invoices screen. */
const DEMO: InvoiceFolderChoice[] = [
  { id: "1f000000-0000-4000-8000-000000000001", name: "PC build" },
  { id: "1f000000-0000-4000-8000-000000000002", name: "Living room" },
];

/** Newest first: the folders the viewer owns and the ones they joined. */
export async function getInvoiceFolderChoices(): Promise<InvoiceFolderChoice[]> {
  if (!supabaseConfigured()) return DEMO;
  if (!(await getUserId())) return [];
  const db = await createClient();
  const rows = await readAllByKey<Row>(
    (after, limit) => {
      let query = db.from("invoice_folders").select("id,name,created_at").order("id").limit(limit);
      if (after) query = query.gt("id", after);
      return query;
    },
    (row) => row.id,
    "Invoice folders unavailable",
  );
  return rows
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id.localeCompare(b.id)))
    .map((row) => ({ id: row.id, name: row.name }));
}
