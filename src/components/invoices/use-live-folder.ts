"use client";

import { useEffect, useEffectEvent, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { z } from "zod";
import { currencyCodeSchema } from "@/features/currencies/schema";
import type { InvoiceItem } from "@/features/invoices/schema";
import { useRouter } from "@/i18n/navigation";
import { readMinor } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";

export type LiveItemChange = { type: "upsert"; item: InvoiceItem } | { type: "delete"; id: string };
export type LiveStatus = "live" | "polling";

/** Membership is not published (see the migration), so it is learned by refetching this often. */
export const REFRESH_MS = 30_000;
/** How often to refetch, and to retry a closed channel, while live updates are down. */
export const POLL_MS = 5_000;

const itemRow = z.object({
  id: z.uuid(), folder_id: z.uuid(), category_id: z.uuid(), name: z.string().min(1), currency: currencyCodeSchema,
  decimal_places: z.number().int().min(0).max(8),
  price_minor: z.union([z.number(), z.string()]),
  quantity: z.number().int().min(1),
  created_by: z.uuid().nullable(), created_at: z.string().min(1), updated_at: z.string().min(1),
});
const keyRow = z.object({ id: z.uuid() });

/** A row from a realtime event (database column names) as an item, or null when it is not a valid row of this folder. */
function toItem(value: unknown, folderId: string): InvoiceItem | null {
  const row = itemRow.safeParse(value);
  if (!row.success || row.data.folder_id !== folderId) return null;
  let priceMinor: number;
  try { priceMinor = readMinor(row.data.price_minor); } catch { return null; }
  const { id, category_id: categoryId, name, currency, decimal_places: decimalPlaces, quantity, created_by: createdBy, created_at: createdAt, updated_at: updatedAt } = row.data;
  return { id, folderId, categoryId, name, currency, decimalPlaces, priceMinor, quantity, createdBy, createdAt, updatedAt };
}

let opened = 0;

/**
 * Keeps an open folder in step with other people: row changes arrive over one Realtime
 * channel (inserts and updates filtered to this folder under the viewer's read access;
 * deletes as bare ids), and the page is refetched every 30 seconds while visible, on
 * return to the tab and on reconnect, which is how membership changes and removal show.
 * If the channel fails, the page is refetched every 5 seconds while visible until it is back.
 */
export function useLiveFolder(folderId: string, handlers: {
  onItem: (change: LiveItemChange) => void;
  onMembers: () => void;
  onLost: () => void;
}): { status: LiveStatus } {
  const router = useRouter();
  const [status, setStatus] = useState<LiveStatus>("live");

  const onItem = useEffectEvent((change: LiveItemChange) => handlers.onItem(change));
  const onLost = useEffectEvent(() => handlers.onLost());
  const onRenamed = useEffectEvent(() => router.refresh());
  const onCategories = useEffectEvent(() => router.refresh());
  const refetch = useEffectEvent(() => { router.refresh(); handlers.onMembers(); });

  useEffect(() => {
    // Preview mode without a database: nothing to listen to.
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return;
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    // True from a SUBSCRIBED until the channel next leaves that state.
    let subscribed = false;
    const close = () => {
      const current = channel;
      channel = null;
      if (current) void supabase.removeChannel(current);
    };
    /** Live updates are down: poll, and try a fresh channel shortly. */
    const restart = () => {
      subscribed = false;
      close();
      setStatus("polling");
      clearTimeout(retry);
      retry = setTimeout(open, POLL_MS);
    };
    // A join sent before the session token reaches Realtime is anonymous, and the server then
    // rejects the filters (the anonymous role cannot read these tables), so set it first. If that
    // fails, joining would be anonymous: take the same path as a channel that failed.
    const open = () => {
      void supabase.realtime.setAuth().then(() => { if (!disposed) join(); }, () => { if (!disposed) restart(); });
    };
    const join = () => {
      // A fresh topic each time: realtime-js hands back a channel that is still leaving under the same name.
      const current: RealtimeChannel = supabase.channel(`invoice-folder:${folderId}:${++opened}`)
        // Inserts and updates of this folder's rows; the database applies the viewer's read access.
        .on("postgres_changes", { event: "*", schema: "public", table: "invoice_items", filter: `folder_id=eq.${folderId}` }, (payload) => {
          if (disposed || current !== channel || payload.eventType === "DELETE") return;
          const item = toItem(payload.new, folderId);
          if (item) onItem({ type: "upsert", item });
        })
        // A DELETE carries only the row id, so a folder filter never matches it: listen to every
        // delete and pass the bare id on. Another folder's id is ignored (the folder has no such row).
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "invoice_items" }, (payload) => {
          if (disposed || current !== channel) return;
          const key = keyRow.safeParse(payload.old);
          if (key.success) onItem({ type: "delete", id: key.data.id });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "invoice_folders", filter: `id=eq.${folderId}` }, (payload) => {
          if (disposed || current !== channel) return;
          const key = keyRow.safeParse(payload.eventType === "DELETE" ? payload.old : payload.new);
          if (!key.success || key.data.id !== folderId) return;
          if (payload.eventType === "DELETE") onLost(); else onRenamed();
        })
        // Categories added, renamed or deleted by someone else: the page is refetched with the new list.
        .on("postgres_changes", { event: "*", schema: "public", table: "invoice_categories", filter: `folder_id=eq.${folderId}` }, () => {
          if (disposed || current !== channel) return;
          onCategories();
        })
        // The join itself succeeds even when the server cannot set up the changes; it says so here.
        .on("system", {}, (payload: { extension?: unknown; status?: unknown }) => {
          if (disposed || current !== channel) return;
          if (payload?.extension === "postgres_changes" && payload.status === "error") restart();
        });
      channel = current;
      current.subscribe((state) => {
        if (disposed || current !== channel) return;
        if (state === "SUBSCRIBED") {
          setStatus("live");
          // Changes made before the channel was up (or while it was down) were never delivered: catch up once.
          if (!subscribed) { subscribed = true; refetch(); }
          return;
        }
        subscribed = false;
        // After an error or a timeout realtime-js rejoins by itself; a closed channel is gone, so open a new one.
        if (state === "CLOSED") restart(); else setStatus("polling");
      });
    };
    open();
    return () => { disposed = true; clearTimeout(retry); close(); };
  }, [folderId]);

  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    const timer = setInterval(() => { if (visible()) refetch(); }, status === "polling" ? POLL_MS : REFRESH_MS);
    const onVisibility = () => { if (visible()) refetch(); };
    const onOnline = () => { if (visible()) refetch(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [status]);

  return { status };
}
