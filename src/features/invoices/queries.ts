import "server-only";
import { z } from "zod";
import { currencyCodeSchema } from "@/features/currencies/schema";
import { readMinor } from "@/lib/money";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { readAllByKey } from "@/lib/supabase/read-all";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/supabase/user";
import { sortCategories } from "./display";
import type { InvoiceCategory, InvoiceFolderSummary, InvoiceItem, InvoiceMember } from "./schema";
import { tokenSchema } from "./schema";
import { totalsByCurrency } from "./totals";

export type InvoiceFolderDetail = {
  id: string;
  name: string;
  isOwner: boolean;
  viewerId: string;
  /** Newest first. */
  items: InvoiceItem[];
  /** Custom ones in the order they were made, then "Other". */
  categories: InvoiceCategory[];
  /** Active people (owner first); the owner also gets the removed ones. */
  members: InvoiceMember[];
  /** The share-link token, owner only; null when there is no active link. */
  link: string | null;
  /** Whether new people can join with the link (the owner's joining switch); true when there is no link. */
  linkEnabled: boolean;
};

const idSchema = z.uuid();

type FolderRow = { id: string; name: string; owner_id: string; created_at: string };
type CategoryRow = { id: string; folder_id: string; name: string; is_default: boolean; created_at: string };
type ItemRow = {
  id: string; folder_id: string; category_id: string; name: string; currency: string; decimal_places: number | string;
  price_minor: number | string; created_by: string | null; created_at: string; updated_at: string;
};
type MemberRow = { folder_id: string; user_id: string; display_name: string | null; joined_at: string; removed_at: string | null };

const newestFirst = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id.localeCompare(b.id);

function toItem(row: ItemRow): InvoiceItem {
  const decimalPlaces = Number(row.decimal_places);
  if (!currencyCodeSchema.safeParse(row.currency).success || !Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 8) {
    throw new Error("Invalid invoice currency");
  }
  return {
    id: row.id, folderId: row.folder_id, categoryId: row.category_id, name: row.name, currency: row.currency, decimalPlaces,
    priceMinor: readMinor(row.price_minor), createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// --- Preview mode: clearly synthetic data so the screens can be seen without a database. ---

const DEMO_VIEWER = "1a000000-0000-4000-8000-000000000001";
const DEMO_KARIM = "1a000000-0000-4000-8000-000000000002";
const DEMO_LINA = "1a000000-0000-4000-8000-000000000003";
const DEMO_PC = "1f000000-0000-4000-8000-000000000001";
const DEMO_LIVING = "1f000000-0000-4000-8000-000000000002";
/** The join page can be previewed with this synthetic link in preview mode. */
export const DEMO_INVOICE_TOKEN = "d".repeat(64);

const demoCategory = (n: number, folderId: string, name: string, isDefault: boolean, createdAt: string): InvoiceCategory =>
  ({ id: `1c000000-0000-4000-8000-${String(n).padStart(12, "0")}`, folderId, name, isDefault, createdAt });
const demoCategoryId = (n: number) => `1c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const DEMO_CATEGORIES: InvoiceCategory[] = [
  demoCategory(1, DEMO_PC, "Case & Cooling", false, "2026-11-03T08:00:00Z"),
  demoCategory(2, DEMO_PC, "Processing", false, "2026-11-03T08:01:00Z"),
  demoCategory(3, DEMO_PC, "Other", true, "2026-11-03T07:00:00Z"),
  demoCategory(4, DEMO_LIVING, "Other", true, "2026-11-02T07:00:00Z"),
];

const demoItem = (n: number, folderId: string, categoryId: string, name: string, currency: string, decimalPlaces: number, priceMinor: number, createdBy: string, createdAt: string): InvoiceItem =>
  ({ id: `1d000000-0000-4000-8000-${String(n).padStart(12, "0")}`, folderId, categoryId, name, currency, decimalPlaces, priceMinor, createdBy, createdAt, updatedAt: createdAt });

const DEMO_ITEMS: InvoiceItem[] = [
  demoItem(4, DEMO_PC, demoCategoryId(1), "MSI MAG Forge 120A Airflow Mid-Tower (6× Fans, 330mm GPU support)", "USD", 2, 10000, DEMO_VIEWER, "2026-11-05T09:00:00Z"),
  demoItem(5, DEMO_PC, demoCategoryId(3), "Cables", "LBP", 0, 1350000, DEMO_VIEWER, "2026-11-05T08:00:00Z"),
  demoItem(3, DEMO_PC, demoCategoryId(2), "GPU", "USD", 2, 45000, DEMO_VIEWER, "2026-11-04T08:00:00Z"),
  demoItem(2, DEMO_PC, demoCategoryId(2), "CPU", "USD", 2, 25000, DEMO_VIEWER, "2026-11-04T07:00:00Z"),
  demoItem(1, DEMO_PC, demoCategoryId(1), "Thermal paste", "LBP", 0, 450000, DEMO_VIEWER, "2026-11-03T07:00:00Z"),
  demoItem(8, DEMO_LIVING, demoCategoryId(4), "Curtains", "LBP", 0, 2700000, DEMO_LINA, "2026-11-03T09:00:00Z"),
  demoItem(7, DEMO_LIVING, demoCategoryId(4), "Lamp", "USD", 2, 4500, DEMO_VIEWER, "2026-11-02T10:00:00Z"),
  demoItem(6, DEMO_LIVING, demoCategoryId(4), "Sofa", "USD", 2, 38000, DEMO_KARIM, "2026-11-02T08:00:00Z"),
];

const member = (userId: string, displayName: string | null, isOwner: boolean, joinedAt: string): InvoiceMember =>
  ({ userId, displayName, isOwner, joinedAt, removed: false });

/** Newest first. */
const DEMO_FOLDERS: InvoiceFolderDetail[] = [
  {
    id: DEMO_PC, name: "PC build", isOwner: true, viewerId: DEMO_VIEWER, link: null, linkEnabled: true,
    members: [member(DEMO_VIEWER, null, true, "2026-11-03T00:00:00Z")],
    items: DEMO_ITEMS.filter((item) => item.folderId === DEMO_PC),
    categories: sortCategories(DEMO_CATEGORIES.filter((c) => c.folderId === DEMO_PC)),
  },
  {
    id: DEMO_LIVING, name: "Living room", isOwner: false, viewerId: DEMO_VIEWER, link: null, linkEnabled: true,
    members: [
      member(DEMO_KARIM, "Karim", true, "2026-11-02T00:00:00Z"),
      member(DEMO_VIEWER, "Dana", false, "2026-11-02T09:00:00Z"),
      member(DEMO_LINA, "Lina", false, "2026-11-03T08:00:00Z"),
    ],
    items: DEMO_ITEMS.filter((item) => item.folderId === DEMO_LIVING),
    categories: sortCategories(DEMO_CATEGORIES.filter((c) => c.folderId === DEMO_LIVING)),
  },
];

const summarize = (folder: InvoiceFolderDetail): InvoiceFolderSummary => ({
  id: folder.id, name: folder.name, isOwner: folder.isOwner,
  memberCount: folder.members.filter((m) => !m.removed).length, itemCount: folder.items.length, totals: totalsByCurrency(folder.items),
});

/** Newest first. Includes folders the viewer joined; `memberCount` counts active people including the owner. */
export async function getInvoiceFolders(): Promise<InvoiceFolderSummary[]> {
  if (!supabaseConfigured()) return DEMO_FOLDERS.map(summarize);
  const viewerId = await getUserId();
  if (!viewerId) return [];
  const db = await createClient();
  const [folders, items, members] = await Promise.all([
    readAllByKey<FolderRow>(
      (after, limit) => {
        let query = db.from("invoice_folders").select("id,name,owner_id,created_at").order("id").limit(limit);
        if (after) query = query.gt("id", after);
        return query;
      },
      (row) => row.id,
      "Invoice folders unavailable",
    ),
    readAllByKey<ItemRow>(
      (after, limit) => {
        let query = db.from("invoice_items").select("id,folder_id,category_id,name,currency,decimal_places,price_minor,created_by,created_at,updated_at").order("id").limit(limit);
        if (after) query = query.gt("id", after);
        return query;
      },
      (row) => row.id,
      "Invoice items unavailable",
    ),
    readAllByKey<MemberRow>(
      (after, limit) => {
        let query = db.from("invoice_members").select("folder_id,user_id,display_name,joined_at,removed_at").order("folder_id").order("user_id").limit(limit);
        if (after) {
          const [folder, user] = after.split("|");
          query = query.or(`folder_id.gt.${folder},and(folder_id.eq.${folder},user_id.gt.${user})`);
        }
        return query;
      },
      (row) => `${row.folder_id}|${row.user_id}`,
      "Invoice members unavailable",
    ),
  ]);

  const itemsByFolder = new Map<string, InvoiceItem[]>();
  for (const row of items) {
    const item = toItem(row);
    itemsByFolder.set(item.folderId, [...(itemsByFolder.get(item.folderId) ?? []), item]);
  }
  const people = new Map<string, number>();
  for (const row of members) if (row.removed_at === null) people.set(row.folder_id, (people.get(row.folder_id) ?? 0) + 1);

  return folders
    .sort((a, b) => newestFirst({ createdAt: a.created_at, id: a.id }, { createdAt: b.created_at, id: b.id }))
    .map((row) => {
      const rows = itemsByFolder.get(row.id) ?? [];
      return {
        id: row.id, name: row.name, isOwner: row.owner_id === viewerId,
        memberCount: people.get(row.id) ?? 0, itemCount: rows.length, totals: totalsByCurrency(rows),
      };
    });
}

/** How many folders the viewer can see (owned and joined): a head count, for overviews that show no totals. */
export async function getInvoiceFolderCount(): Promise<number> {
  if (!supabaseConfigured()) return DEMO_FOLDERS.length;
  if (!(await getUserId())) return 0;
  const db = await createClient();
  const { count, error } = await db.from("invoice_folders").select("id", { count: "exact", head: true });
  if (error) throw new Error("Invoice folders unavailable");
  return count ?? 0;
}

/** One folder for an active member, or null (not a member, removed, or no such folder). */
export async function getInvoiceFolder(id: string): Promise<InvoiceFolderDetail | null> {
  if (!supabaseConfigured()) {
    const demo = DEMO_FOLDERS.find((folder) => folder.id === id);
    // A copy, so a caller can never change the demo data every later visit reads.
    return demo ? structuredClone(demo) : null;
  }
  if (!idSchema.safeParse(id).success) return null;
  const viewerId = await getUserId();
  if (!viewerId) return null;
  const db = await createClient();
  const found = await db.from("invoice_folders").select("id,name,owner_id,created_at").eq("id", id).maybeSingle();
  if (found.error) throw new Error("Invoice folder unavailable");
  if (!found.data) return null;
  const folder = found.data as FolderRow;
  const isOwner = folder.owner_id === viewerId;

  const [items, categories, members, link] = await Promise.all([
    readAllByKey<ItemRow>(
      (after, limit) => {
        let query = db.from("invoice_items").select("id,folder_id,category_id,name,currency,decimal_places,price_minor,created_by,created_at,updated_at").eq("folder_id", id).order("id").limit(limit);
        if (after) query = query.gt("id", after);
        return query;
      },
      (row) => row.id,
      "Invoice items unavailable",
    ),
    readAllByKey<CategoryRow>(
      (after, limit) => {
        let query = db.from("invoice_categories").select("id,folder_id,name,is_default,created_at").eq("folder_id", id).order("id").limit(limit);
        if (after) query = query.gt("id", after);
        return query;
      },
      (row) => row.id,
      "Invoice categories unavailable",
    ),
    readAllByKey<MemberRow>(
      (after, limit) => {
        let query = db.from("invoice_members").select("folder_id,user_id,display_name,joined_at,removed_at").eq("folder_id", id).order("user_id").limit(limit);
        if (after) query = query.gt("user_id", after);
        return query;
      },
      (row) => row.user_id,
      "Invoice members unavailable",
    ),
    isOwner ? db.from("invoice_links").select("token,enabled").eq("folder_id", id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (link.error) throw new Error("Invoice link unavailable");

  // Access is "active member": a viewer without an active row sees nothing, even if a stale read returned the folder.
  if (!members.some((row) => row.user_id === viewerId && row.removed_at === null)) return null;

  const people: InvoiceMember[] = members
    .filter((row) => row.removed_at === null || isOwner)
    .map((row) => ({
      userId: row.user_id, displayName: row.display_name, isOwner: row.user_id === folder.owner_id,
      joinedAt: row.joined_at, removed: row.removed_at !== null,
    }))
    .sort((a, b) => Number(a.removed) - Number(b.removed) || Number(b.isOwner) - Number(a.isOwner) || (a.joinedAt < b.joinedAt ? -1 : a.joinedAt > b.joinedAt ? 1 : a.userId.localeCompare(b.userId)));

  const linkRow = link.data as { token?: unknown; enabled?: unknown } | null;
  const token = tokenSchema.safeParse(linkRow?.token);
  return {
    id: folder.id, name: folder.name, isOwner, viewerId,
    items: items.map(toItem).sort(newestFirst),
    categories: sortCategories(categories.map((row) => ({
      id: row.id, folderId: row.folder_id, name: row.name, isDefault: row.is_default, createdAt: row.created_at,
    }))),
    members: people,
    link: isOwner && token.success ? token.data : null,
    linkEnabled: linkRow?.enabled !== false,
  };
}

/**
 * The folder behind `token` when the viewer owns it (only an owner can read links), so the
 * owner opening their own link goes straight to the folder. Null for everyone else.
 */
export async function ownInvoiceFolderForLink(token: string): Promise<string | null> {
  if (!supabaseConfigured() || !tokenSchema.safeParse(token).success) return null;
  if (!(await getUserId())) return null;
  const db = await createClient();
  const { data, error } = await db.from("invoice_links").select("folder_id").eq("token", token).maybeSingle();
  const folderId = idSchema.safeParse((data as { folder_id?: unknown } | null)?.folder_id);
  return !error && folderId.success ? folderId.data : null;
}

/** The folder name for the join page, or null when the link would not work for the viewer (or the call failed). */
export async function previewInvoiceLink(token: string): Promise<{ name: string } | null> {
  if (!tokenSchema.safeParse(token).success) return null;
  if (!supabaseConfigured()) return token === DEMO_INVOICE_TOKEN ? { name: "Living room" } : null;
  const db = await createClient();
  const { data, error } = await db.rpc("invoice_link_preview", { p_token: token });
  // The generated type says `string`, but the function returns null for any link that does not work.
  const name = data as string | null;
  if (error || typeof name !== "string" || name.length === 0) return null;
  return { name };
}
