"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient, databaseActionError, type ActionError, type ActionResult } from "@/lib/supabase/action";
import {
  folderCreateSchema, folderRenameSchema, itemCreateSchema, itemEditSchema, personNameSchema, tokenSchema,
  type FolderCreateInput, type ItemCreateInput, type ItemEditInput, type SavedTimes,
} from "./schema";

const idSchema = z.uuid();
type DatabaseError = { code?: string; message?: string };

/** A duplicate key here means a reused id, never a duplicate currency. */
function databaseError(error: DatabaseError): ActionError {
  return error.code === "23505" ? "conflict" : databaseActionError(error);
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

/** Answers with the saved row's server timestamps (also for a retry of a row already saved). */
export async function addItem(input: ItemCreateInput): Promise<ActionResult<SavedTimes>> {
  const parsed = itemCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { id, folderId, name, currency, decimalPlaces, priceMinor, expectedUnits } = parsed.data;
  try {
    const ctx = await actionClient(expectedUnits);
    if (ctx.error) return { ok: false, error: ctx.error };
    // The id is chosen by the form, so a retry after a lost response is a no-op.
    const { data, error } = await ctx.supabase.from("invoice_items")
      .upsert({ id, folder_id: folderId, name, currency, decimal_places: decimalPlaces, price_minor: priceMinor }, { onConflict: "id", ignoreDuplicates: true })
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
  const { name, priceMinor, currency, decimalPlaces } = parsed.data;
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.from("invoice_items")
      .update({ name, price_minor: priceMinor, ...(currency !== undefined && decimalPlaces !== undefined ? { currency, decimal_places: decimalPlaces } : {}) })
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

/** Owner only. Nobody new can join; people already in the folder stay. */
export async function disableLink(folderId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(folderId).success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { error } = await ctx.supabase.rpc("disable_invoice_link", { p_folder: folderId });
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
