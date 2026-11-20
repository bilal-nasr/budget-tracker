"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile } from "@/features/profile/queries";
import { MAX_ITEM_DESCRIPTION_LENGTH } from "@/features/transactions/breakdown-summary";
import { todayIn } from "@/features/transactions/group";
import { createTransactionCore, deleteTransactionCore, type TransactionMutation } from "@/features/transactions/mutations-core";
import { sumMinor } from "@/lib/money";
import { actionClient, databaseActionError, type ActionError, type ActionResult } from "@/lib/supabase/action";
import {
  categoryCreateSchema, categoryRenameSchema, folderCreateSchema, folderRenameSchema, itemCreateSchema, itemEditSchema,
  itemsDeleteSchema, itemsMoveSchema, itemsPaySchema, itemsRestoreSchema, personNameSchema, tokenSchema,
  type CategoryCreateInput, type FolderCreateInput, type ItemCreateInput, type ItemEditInput,
  type ItemsDeleteInput, type ItemsMoveInput, type ItemsPayInput, type ItemsRestoreInput,
  type PaidRow, type RestoredRow, type SavedRow, type SavedTimes,
} from "./schema";
import { lineMinor } from "./totals";

const idSchema = z.uuid();
type DatabaseError = { code?: string; message?: string };

/**
 * A duplicate key here means a reused id or name, never a duplicate currency; a missing foreign
 * key means a category someone deleted meanwhile. Both are "changed meanwhile".
 */
function databaseError(error: DatabaseError): ActionError {
  // A paid row is frozen (or was paid by someone else meanwhile).
  if (error.message === "invoices.paid") return "paymentChanged";
  return error.code === "23505" || error.code === "23503" ? "conflict" : databaseActionError(error);
}

/**
 * `invoices.invalid` is raised with errcode 42501 when the person is not in the folder or the row's id
 * still belongs to a deleted row whose Undo is open (both a `conflict`), and with the default P0001 by
 * the currency trigger (the currency is gone or disabled for them).
 */
function itemWriteError(error: DatabaseError): ActionError {
  return error.code === "P0001" && error.message === "invoices.invalid" ? "currencyUnavailable" : databaseError(error);
}

/** The cap check runs before the insert's conflict check, so a retry of the last allowed row hits the cap too. */
const isLimit = (error: DatabaseError) => error.message === "invoices.limit";
const isDuplicate = (error: DatabaseError) => error.code === "23505";

/** Read back with a saved item, so the screen orders and compares it by the server's clock. */
const SAVED_COLUMNS = "id,created_at,updated_at";
function savedTimes(row: { created_at?: unknown; updated_at?: unknown } | null | undefined): SavedTimes | null {
  const createdAt = row?.created_at, updatedAt = row?.updated_at;
  if (typeof createdAt !== "string" || typeof updatedAt !== "string") return null;
  if (Number.isNaN(Date.parse(createdAt)) || Number.isNaN(Date.parse(updatedAt))) return null;
  return { createdAt, updatedAt };
}

export async function createFolder(input: FolderCreateInput): Promise<ActionResult> {
  const parsed = folderCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    // The id is chosen by the form, so a retry after a lost response is a no-op.
    const { data, error } = await ctx.supabase.from("invoice_folders")
      .upsert({ id: parsed.data.id, name: parsed.data.name }, { onConflict: "id", ignoreDuplicates: true }).select("id");
    if (error && !isDuplicate(error) && !isLimit(error)) return { ok: false, error: databaseError(error) };
    if (error || !data?.length) {
      // Skipped as a duplicate: fine only if the folder is this person's own (an id could be taken by someone else).
      const mine = await ctx.supabase.from("invoice_folders").select("id").eq("id", parsed.data.id).eq("owner_id", ctx.userId).maybeSingle();
      if (mine.error) return { ok: false, error: "failed" };
      if (!mine.data) return { ok: false, error: error && isLimit(error) ? "limitReached" : "conflict" };
    }
    revalidatePath("/", "layout");
    return { ok: true };
  } catch { return { ok: false, error: "failed" }; }
}

export async function renameFolder(id: string, input: { name: string }): Promise<ActionResult> {
  const parsed = folderRenameSchema.safeParse(input);
  if (!idSchema.safeParse(id).success || !parsed.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    // Only the owner can update a folder; anyone else (or a deleted folder) matches no row.
    const { data, error } = await ctx.supabase.from("invoice_folders").update({ name: parsed.data.name }).eq("id", id).select("id");
    if (error) return { ok: false, error: databaseError(error) };
    if (!data?.length) return { ok: false, error: "conflict" };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch { return { ok: false, error: "failed" }; }
}

/**
 * Deletes the folder and its rows (owner only). A folder that is already gone counts as deleted.
 * Deliberately no `revalidatePath`: that re-renders the open folder page, which no longer finds
 * its folder and redirects to the "folder unavailable" notice before the screen can leave. The
 * screen goes to the list itself and refreshes there (see `DeleteFolderSheet`).
 */
export async function deleteFolder(id: string): Promise<ActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.from("invoice_folders").delete().eq("id", id).select("id");
    if (error) return { ok: false, error: databaseError(error) };
    if (!data?.length) {
      // Nothing deleted: fine if the folder is gone, but a folder still visible belongs to someone else.
      const still = await ctx.supabase.from("invoice_folders").select("id").eq("id", id).maybeSingle();
      if (still.error) return { ok: false, error: "failed" };
      if (still.data) return { ok: false, error: "conflict" };
    }
    return { ok: true };
  } catch { return { ok: false, error: "failed" }; }
}

/**
 * Categories. Everyone in the folder can add, rename and delete them (the database enforces it).
 * `isLimit` covers the 30-category cap; a name already used in the folder is a `conflict`.
 */
export async function addCategory(input: CategoryCreateInput): Promise<ActionResult> {
  const parsed = categoryCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    // The id is chosen by the sheet, so a retry after a lost response is a no-op.
    const { data, error } = await ctx.supabase.from("invoice_categories")
      .upsert({ id: parsed.data.id, folder_id: parsed.data.folderId, name: parsed.data.name }, { onConflict: "id", ignoreDuplicates: true }).select("id");
    if (error && !isDuplicate(error) && !isLimit(error)) return { ok: false, error: databaseError(error) };
    if (error || !data?.length) {
      // Skipped: fine only if that category is already there in this folder (a retry); otherwise the name or id is taken.
      const mine = await ctx.supabase.from("invoice_categories").select("id").eq("id", parsed.data.id).eq("folder_id", parsed.data.folderId).maybeSingle();
      if (mine.error) return { ok: false, error: "failed" };
      if (!mine.data) return { ok: false, error: error && isLimit(error) ? "limitReached" : "conflict" };
    }
    revalidatePath("/", "layout");
    return { ok: true };
  } catch { return { ok: false, error: "failed" }; }
}

export async function renameCategory(id: string, input: { name: string }): Promise<ActionResult> {
  const parsed = categoryRenameSchema.safeParse(input);
  if (!idSchema.safeParse(id).success || !parsed.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.from("invoice_categories").update({ name: parsed.data.name }).eq("id", id).select("id");
    if (error) return { ok: false, error: databaseError(error) };
    if (!data?.length) return { ok: false, error: "conflict" };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch { return { ok: false, error: "failed" }; }
}

/** The category's rows move to "Other". "Other" itself cannot be deleted; a category already gone counts as deleted. */
export async function deleteCategory(id: string): Promise<ActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { error } = await ctx.supabase.rpc("delete_invoice_category", { p_category: id });
    if (error) return { ok: false, error: databaseError(error) };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch { return { ok: false, error: "failed" }; }
}

/** Answers with the saved row's server timestamps (also for a retry of a row already saved). */
export async function addItem(input: ItemCreateInput): Promise<ActionResult<SavedTimes>> {
  const parsed = itemCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { id, folderId, categoryId, name, currency, decimalPlaces, priceMinor, quantity, expectedUnits } = parsed.data;
  try {
    const ctx = await actionClient(expectedUnits);
    if (ctx.error) return { ok: false, error: ctx.error };
    // The id is chosen by the form, so a retry after a lost response is a no-op.
    const { data, error } = await ctx.supabase.from("invoice_items")
      .upsert({ id, folder_id: folderId, category_id: categoryId, name, currency, decimal_places: decimalPlaces, price_minor: priceMinor, quantity }, { onConflict: "id", ignoreDuplicates: true })
      .select(SAVED_COLUMNS);
    if (error && !isDuplicate(error) && !isLimit(error)) return { ok: false, error: itemWriteError(error) };
    let row = error ? undefined : data?.[0];
    if (!row) {
      // Skipped as a duplicate: success only if that row is visible in this folder (another user could hold a leaked id).
      const mine = await ctx.supabase.from("invoice_items").select(SAVED_COLUMNS).eq("id", id).eq("folder_id", folderId).maybeSingle();
      if (mine.error) return { ok: false, error: "failed" };
      if (!mine.data) return { ok: false, error: error && isLimit(error) ? "limitReached" : "conflict" };
      row = mine.data;
    }
    revalidatePath("/", "layout");
    const times = savedTimes(row);
    return times ? { ok: true, ...times } : { ok: false, error: "failed" };
  } catch { return { ok: false, error: "failed" }; }
}

/**
 * A row someone else deleted meanwhile is a `conflict`, which the screen shows as "this item was removed".
 * Answers with the saved row's server timestamps.
 */
export async function updateItem(id: string, input: ItemEditInput): Promise<ActionResult<SavedTimes>> {
  const parsed = itemEditSchema.safeParse(input);
  if (!idSchema.safeParse(id).success || !parsed.success) return { ok: false, error: "invalid" };
  const { name, priceMinor, quantity, categoryId, currency, decimalPlaces } = parsed.data;
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.from("invoice_items")
      .update({ name, price_minor: priceMinor, quantity, ...(categoryId !== undefined ? { category_id: categoryId } : {}), ...(currency !== undefined && decimalPlaces !== undefined ? { currency, decimal_places: decimalPlaces } : {}) })
      .eq("id", id).select(SAVED_COLUMNS);
    if (error) return { ok: false, error: itemWriteError(error) };
    if (!data?.length) return { ok: false, error: "conflict" };
    revalidatePath("/", "layout");
    const times = savedTimes(data[0]);
    return times ? { ok: true, ...times } : { ok: false, error: "failed" };
  } catch { return { ok: false, error: "failed" }; }
}

/** Any member may delete any row; the database keeps a copy for `restoreItem`. A row already gone counts as deleted. */
export async function deleteItem(id: string): Promise<ActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { error } = await ctx.supabase.from("invoice_items").delete().eq("id", id);
    if (error) return { ok: false, error: databaseError(error) };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch { return { ok: false, error: "failed" }; }
}

/**
 * Undo of a delete: the database puts the row back with its original author and values.
 * It only works for 10 minutes after the delete; an expired or taken id is a `conflict`.
 * Answers with the restored row's server timestamps, like `addItem`.
 */
export async function restoreItem(id: string): Promise<ActionResult<SavedTimes>> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { error } = await ctx.supabase.rpc("restore_invoice_item", { p_item: id });
    if (error) return { ok: false, error: databaseError(error) };
    revalidatePath("/", "layout");
    const back = await ctx.supabase.from("invoice_items").select(SAVED_COLUMNS).eq("id", id).maybeSingle();
    const times = back.error ? null : savedTimes(back.data);
    return times ? { ok: true, ...times } : { ok: false, error: "failed" };
  } catch { return { ok: false, error: "failed" }; }
}

const savedRows = z.array(z.object({ id: z.uuid(), updated_at: z.string().min(1) }));
const restoredRows = z.array(z.object({ id: z.uuid(), created_at: z.string().min(1), updated_at: z.string().min(1) }));
const paidRows = z.array(z.object({ id: z.uuid(), updated_at: z.string().min(1), paid_on: z.iso.date(), paid_at: z.string().min(1) }));

/**
 * Bulk delete: the ticked rows go in one statement (all of them or none). Rows someone else
 * deleted meanwhile are simply already gone, so this still succeeds; `deleted` lists the rows
 * this call removed, which are the ones `restoreItems` can bring back.
 */
export async function deleteItems(input: ItemsDeleteInput): Promise<ActionResult<{ deleted: string[] }>> {
  const parsed = itemsDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.rpc("delete_invoice_items", { p_folder: parsed.data.folderId, p_items: parsed.data.itemIds });
    if (error) return { ok: false, error: databaseError(error) };
    const deleted = z.array(z.uuid()).safeParse(data ?? []);
    if (!deleted.success) return { ok: false, error: "failed" };
    revalidatePath("/", "layout");
    return { ok: true, deleted: deleted.data };
  } catch { return { ok: false, error: "failed" }; }
}

/**
 * Bulk move to one of the folder's categories, in one statement. `rows` are the chosen rows
 * that still exist, with their server timestamps; one missing from it was deleted by someone
 * else meanwhile. A category deleted meanwhile is a `conflict`.
 */
export async function moveItems(input: ItemsMoveInput): Promise<ActionResult<{ rows: SavedRow[] }>> {
  const parsed = itemsMoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.rpc("move_invoice_items", { p_folder: parsed.data.folderId, p_items: parsed.data.itemIds, p_category: parsed.data.categoryId });
    if (error) return { ok: false, error: databaseError(error) };
    const rows = savedRows.safeParse(data ?? []);
    if (!rows.success) return { ok: false, error: "failed" };
    revalidatePath("/", "layout");
    return { ok: true, rows: rows.data.map((row) => ({ id: row.id, updatedAt: row.updated_at })) };
  } catch { return { ok: false, error: "failed" }; }
}

/** Undo of a bulk delete: every row comes back or none does (10 minutes, like `restoreItem`). */
export async function restoreItems(input: ItemsRestoreInput): Promise<ActionResult<{ rows: RestoredRow[] }>> {
  const parsed = itemsRestoreSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.rpc("restore_invoice_items", { p_items: parsed.data.itemIds });
    if (error) return { ok: false, error: databaseError(error) };
    const rows = restoredRows.safeParse(data ?? []);
    if (!rows.success || rows.data.length !== parsed.data.itemIds.length) return { ok: false, error: "failed" };
    revalidatePath("/", "layout");
    return { ok: true, rows: rows.data.map((row) => ({ id: row.id, createdAt: row.created_at, updatedAt: row.updated_at })) };
  } catch { return { ok: false, error: "failed" }; }
}

const NOTE_MAX = 140;
const clip = (text: string, max: number) => Array.from(text).length <= max ? text : `${Array.from(text).slice(0, max - 1).join("")}…`;
/**
 * How a row reads inside the expense: its name, then the quantity when there is more than one
 * ("Fans × 3", as the Item calculator writes it). A long name is shortened, never the quantity.
 */
function paidLine(row: { name: string; quantity: number }, max: number): string {
  const suffix = row.quantity > 1 ? ` × ${row.quantity}` : "";
  return `${clip(row.name, max - suffix.length)}${suffix}`;
}

type PayRow = { id: string; name: string; currency: string; decimal_places: number | string; price_minor: number | string; quantity: number | string; created_at: string; paid_on: string | null; paid_transaction_id: string | null };

/** The definite reasons a payment cannot be linked to its rows; anything else may still succeed on a retry. */
function linkError(error: DatabaseError): ActionError | null {
  if (error.message === "invoices.paid") return "paymentChanged";
  if (error.message === "invoices.mismatch" || error.message === "invoices.invalid") return "conflict";
  return null;
}

/**
 * "Pay": records one ordinary expense in the payer's own Activity for each currency among the
 * rows (through the same transaction core as every other expense), then marks those rows paid.
 * Several rows become one expense whose breakdown lists each of them; currencies are never
 * mixed or converted. Nothing is recorded unless every group checks out first.
 *
 * Safe to retry with the same request ids: an expense already recorded under an id is reused,
 * so a lost response can never pay twice. If the rows changed between the expense and the
 * link (deleted, or paid by someone else), that expense is taken back out of Activity.
 */
export async function payItems(input: ItemsPayInput): Promise<ActionResult<{ payments: TransactionMutation[]; rows: PaidRow[] }>> {
  const parsed = itemsPaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { folderId, categoryId, occurredOn, payments, expectedUnits } = parsed.data;
  try {
    if (occurredOn > todayIn((await getProfile()).timezone)) return { ok: false, error: "invalid" };
    const ctx = await actionClient(expectedUnits);
    if (ctx.error) return { ok: false, error: ctx.error };

    // First check every group, so a problem in one currency records nothing in another.
    const groups: { requestId: string; balanceId: string; itemIds: string[]; rows: (PayRow & { minor: number })[]; total: number }[] = [];
    for (const { requestId, balanceId, itemIds } of payments) {
      const found = await ctx.supabase.from("invoice_items")
        .select("id,name,currency,decimal_places,price_minor,quantity,created_at,paid_on,paid_transaction_id").eq("folder_id", folderId).in("id", itemIds);
      if (found.error) return { ok: false, error: "failed" };
      const read = (found.data ?? []) as PayRow[];
      if (read.length !== itemIds.length) return { ok: false, error: "conflict" };
      const { currency } = read[0];
      const decimalPlaces = Number(read[0].decimal_places);
      if (read.some((row) => row.currency !== currency || Number(row.decimal_places) !== decimalPlaces)) return { ok: false, error: "invalid" };
      // The payer's own catalog must price this currency the way the rows do.
      if (expectedUnits[currency] !== decimalPlaces) return { ok: false, error: "currencyUnavailable" };
      // A retry finds its own earlier payment; any other paid row means someone got there first.
      if (read.some((row) => row.paid_on !== null && row.paid_transaction_id !== requestId)) return { ok: false, error: "paymentChanged" };

      // Amounts are denominated by the paying balance, so it must be in the rows' currency.
      const balance = await ctx.supabase.from("wallet_balances").select("currency").eq("id", balanceId).maybeSingle();
      if (balance.error) return { ok: false, error: "failed" };
      if (!balance.data || balance.data.currency !== currency) return { ok: false, error: "walletUnavailable" };

      const rows = read
        .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id.localeCompare(b.id)))
        .map((row) => ({ ...row, minor: lineMinor({ priceMinor: Number(row.price_minor), quantity: Number(row.quantity) }) }));
      let total: number;
      try { total = sumMinor(rows.map((row) => row.minor)); } catch { return { ok: false, error: "invalid" }; }
      groups.push({ requestId, balanceId, itemIds, rows, total });
    }

    const recorded: TransactionMutation[] = [];
    const marked: PaidRow[] = [];
    for (const { requestId, balanceId, itemIds, rows, total } of groups) {
      const prior = await ctx.supabase.from("transactions").select("id,revision,kind,amount_minor,deleted_at").eq("id", requestId).maybeSingle();
      if (prior.error) return { ok: false, error: "failed" };
      let payment: TransactionMutation;
      if (prior.data) {
        if (prior.data.kind !== "expense" || prior.data.deleted_at !== null || Number(prior.data.amount_minor) !== total) return { ok: false, error: "conflict" };
        payment = { id: prior.data.id, revision: prior.data.revision };
      } else {
        const lines = rows.map((row) => ({ description: paidLine({ name: row.name, quantity: Number(row.quantity) }, MAX_ITEM_DESCRIPTION_LENGTH), amountMinor: row.minor }));
        const created = await createTransactionCore({
          expectedUnits, kind: "expense", occurredOn, balanceId, amountMinor: total, categoryId,
          note: clip(lines.map((line) => line.description).join(", "), NOTE_MAX),
          ...(lines.length > 1 ? { items: lines } : {}),
        }, requestId);
        if (!created.ok) return created;
        payment = { id: created.id, revision: created.revision };
      }

      const linked = await ctx.supabase.rpc("mark_invoice_items_paid", { p_folder: folderId, p_items: itemIds, p_transaction: payment.id });
      if (linked.error) {
        const reason = linkError(linked.error);
        // Unknown outcome: the expense exists, and the same request completes the link.
        if (!reason) return { ok: false, error: "failed" };
        // The rows can never be linked: take the expense back out. If that fails, a retry does it again.
        const undone = await deleteTransactionCore(payment.id, payment.revision);
        return { ok: false, error: undone.ok ? reason : "failed" };
      }
      const paid = paidRows.safeParse(linked.data ?? []);
      if (!paid.success || paid.data.length !== itemIds.length) return { ok: false, error: "failed" };
      recorded.push(payment);
      marked.push(...paid.data.map((row) => ({ id: row.id, updatedAt: row.updated_at, paidOn: row.paid_on, paidAt: row.paid_at })));
    }
    revalidatePath("/", "layout");
    return { ok: true, payments: recorded, rows: marked };
  } catch { return { ok: false, error: "failed" }; }
}

/** Owner only. Creates the link or replaces it (the old one stops working). `ownerName` is needed the first time. */
export async function createOrRotateLink(folderId: string, ownerName?: string): Promise<ActionResult<{ token: string }>> {
  const name = ownerName === undefined ? undefined : personNameSchema.safeParse(ownerName);
  if (!idSchema.safeParse(folderId).success || (name && !name.success)) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.rpc("rotate_invoice_link", { p_folder: folderId, p_owner_name: name?.success ? name.data : null });
    if (error) return { ok: false, error: databaseError(error) };
    const token = tokenSchema.safeParse(data);
    if (!token.success) return { ok: false, error: "failed" };
    revalidatePath("/", "layout");
    return { ok: true, token: token.data };
  } catch { return { ok: false, error: "failed" }; }
}

/**
 * Owner only. The joining switch: off means nobody new can join with the link (it stays, so
 * switching back on needs no new URL); people already in the folder stay either way.
 */
export async function setLinkEnabled(folderId: string, enabled: boolean): Promise<ActionResult> {
  if (!idSchema.safeParse(folderId).success || typeof enabled !== "boolean") return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { error } = await ctx.supabase.rpc("set_invoice_link_enabled", { p_folder: folderId, p_enabled: enabled });
    if (error) return { ok: false, error: databaseError(error) };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch { return { ok: false, error: "failed" }; }
}

/**
 * Every link that does not work (unknown, replaced, switched off, folder full, removed person)
 * is the same `linkInvalid`, so the join page never reveals whether a folder exists.
 */
export async function joinFolder(token: string, displayName: string): Promise<ActionResult<{ folderId: string }>> {
  const parsedToken = tokenSchema.safeParse(token);
  const parsedName = personNameSchema.safeParse(displayName);
  if (!parsedToken.success || !parsedName.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.rpc("join_invoice_folder", { p_token: parsedToken.data, p_name: parsedName.data });
    if (error) return { ok: false, error: error.message === "invoices.full" ? "linkInvalid" : databaseError(error) };
    const folderId = idSchema.safeParse(data);
    if (!folderId.success) return { ok: false, error: "failed" };
    revalidatePath("/", "layout");
    return { ok: true, folderId: folderId.data };
  } catch { return { ok: false, error: "failed" }; }
}

/** Changes the viewer's own display name in one folder. */
export async function setMyName(folderId: string, name: string): Promise<ActionResult> {
  const parsed = personNameSchema.safeParse(name);
  if (!idSchema.safeParse(folderId).success || !parsed.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.from("invoice_members")
      .update({ display_name: parsed.data }).eq("folder_id", folderId).eq("user_id", ctx.userId).select("user_id");
    if (error) return { ok: false, error: databaseError(error) };
    if (!data?.length) return { ok: false, error: "conflict" };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch { return { ok: false, error: "failed" }; }
}

/** Owner only. The person loses access at once and cannot rejoin; their rows stay. */
export async function removeMember(folderId: string, userId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(folderId).success || !idSchema.safeParse(userId).success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { error } = await ctx.supabase.rpc("remove_invoice_member", { p_folder: folderId, p_user: userId });
    if (error) return { ok: false, error: databaseError(error) };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch { return { ok: false, error: "failed" }; }
}

/**
 * A member leaves; their rows stay. The owner cannot leave (`conflict`). Like `deleteFolder`, no
 * `revalidatePath`: the open folder page would re-render without access and redirect to the
 * "no longer have access" notice; the screen goes to the list itself and refreshes there.
 */
export async function leaveFolder(folderId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(folderId).success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { error } = await ctx.supabase.rpc("leave_invoice_folder", { p_folder: folderId });
    if (error) return { ok: false, error: databaseError(error) };
    return { ok: true };
  } catch { return { ok: false, error: "failed" }; }
}
