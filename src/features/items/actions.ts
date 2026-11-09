"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile } from "@/features/profile/queries";
import { todayIn } from "@/features/transactions/group";
import { createTransactionCore, type TransactionMutation } from "@/features/transactions/mutations-core";
import { sumMinor } from "@/lib/money";
import { actionClient, databaseActionError, type ActionError, type ActionResult } from "@/lib/supabase/action";
import {
  itemBuySchema, itemCreateSchema, itemEditSchema, itemMoveSchema,
  type ItemBuyInput, type ItemCreateInput, type ItemEditInput, type ItemMoveInput,
} from "./schema";

const idSchema = z.uuid();
const NOTE_MAX = 140;

function databaseError(error: { code?: string; message?: string }): ActionError {
  if (error.message === "items.bought" || error.message === "items.invalid" || error.message === "currency.intentConflict") return "conflict";
  if (error.code === "23503") return "currencyUnavailable";
  return "failed";
}

export async function createItem(input: ItemCreateInput): Promise<ActionResult<{ id: string }>> {
  const parsed = itemCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient(parsed.data.expectedUnits);
    if (ctx.error) return { ok: false, error: ctx.error };
    // The id is chosen by the form, so a retry after a lost response is a no-op.
    const { error } = await ctx.supabase.from("shopping_items")
      .upsert({ id: parsed.data.id, name: parsed.data.name, currency: parsed.data.currency, price_minor: parsed.data.priceMinor }, { onConflict: "id", ignoreDuplicates: true });
    if (error) return { ok: false, error: databaseError(error) };
    revalidatePath("/", "layout");
    return { ok: true, id: parsed.data.id };
  } catch { return { ok: false, error: "failed" }; }
}

export async function updateItem(id: string, input: ItemEditInput): Promise<ActionResult> {
  const parsed = itemEditSchema.safeParse(input);
  if (!idSchema.safeParse(id).success || !parsed.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient(parsed.data.expectedUnits);
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.from("shopping_items")
      .update({ name: parsed.data.name, price_minor: parsed.data.priceMinor }).eq("id", id).eq("user_id", ctx.userId).select("id");
    if (error) return { ok: false, error: databaseError(error) };
    if (!data?.length) return { ok: false, error: "conflict" };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch { return { ok: false, error: "failed" }; }
}

/** Deleting an item never touches Activity: a purchase already recorded stays recorded. */
export async function deleteItem(id: string): Promise<ActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { error } = await ctx.supabase.from("shopping_items").delete().eq("id", id).eq("user_id", ctx.userId);
    if (error) return { ok: false, error: databaseError(error) };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch { return { ok: false, error: "failed" }; }
}

/** Same mapping as the folder screen's own row writes: a disabled currency is `currencyUnavailable`, a lost seat in the folder a `conflict`. */
function moveError(error: { code?: string; message?: string }): ActionError {
  return error.code === "P0001" && error.message === "invoices.invalid" ? "currencyUnavailable" : databaseActionError(error);
}

/**
 * "Move to folder": the chosen items become rows of an invoice folder and leave the list. Nothing
 * reaches Activity. The rows reuse the items' ids, so a retry (or a lost response) never
 * duplicates them: items already moved are recognised in the folder and only the rest is done.
 * The insert is one statement, so a full folder moves nothing.
 */
export async function moveItemsToFolder(input: ItemMoveInput): Promise<ActionResult<{ moved: number }>> {
  const parsed = itemMoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { folderId, itemIds, expectedUnits } = parsed.data;
  try {
    const ctx = await actionClient(expectedUnits);
    if (ctx.error) return { ok: false, error: ctx.error };

    const found = await ctx.supabase.from("shopping_item_status").select("id,name,currency,price_minor,bought_on").in("id", itemIds);
    if (found.error) return { ok: false, error: "failed" };
    const rows = found.data ?? [];
    if (rows.some((row) => row.bought_on !== null)) return { ok: false, error: "conflict" };

    const present = new Set(rows.map((row) => row.id as string));
    const missing = itemIds.filter((id) => !present.has(id));
    if (missing.length) {
      // Gone from the list: fine only if an earlier attempt already put them in this folder.
      const moved = await ctx.supabase.from("invoice_items").select("id").eq("folder_id", folderId).in("id", missing);
      if (moved.error) return { ok: false, error: "failed" };
      if ((moved.data?.length ?? 0) !== missing.length) return { ok: false, error: "conflict" };
    }

    if (rows.length) {
      const inserts = [];
      for (const row of rows) {
        const decimalPlaces = expectedUnits[row.currency as string];
        if (decimalPlaces === undefined) return { ok: false, error: "invalid" };
        inserts.push({ id: row.id as string, folder_id: folderId, name: row.name as string, currency: row.currency as string, decimal_places: decimalPlaces, price_minor: Number(row.price_minor) });
      }
      const { error } = await ctx.supabase.from("invoice_items").upsert(inserts, { onConflict: "id", ignoreDuplicates: true });
      if (error) return { ok: false, error: moveError(error) };
      // A failed delete leaves the rows in both places; the same request completes it.
      const removed = await ctx.supabase.from("shopping_items").delete().in("id", rows.map((row) => row.id as string)).eq("user_id", ctx.userId);
      if (removed.error) return { ok: false, error: "failed" };
    }
    revalidatePath("/", "layout");
    return { ok: true, moved: itemIds.length };
  } catch { return { ok: false, error: "failed" }; }
}

/** One expense in Activity for the items, whose breakdown lists each of them (a single item is the note). */
function purchaseNote(names: readonly string[]): string {
  const joined = names.join(", ");
  return Array.from(joined).length <= NOTE_MAX ? joined : `${Array.from(joined).slice(0, NOTE_MAX - 1).join("")}…`;
}

/**
 * "I bought this": records one expense in Activity for the chosen items and links
 * them to it. Safe to retry with the same requestId: an expense already recorded
 * under that id is reused, so a lost response can never double-count the purchase.
 */
export async function buyItems(input: ItemBuyInput): Promise<ActionResult<TransactionMutation>> {
  const parsed = itemBuySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { requestId, itemIds, balanceId, categoryId, occurredOn, expectedUnits } = parsed.data;
  try {
    if (occurredOn > todayIn((await getProfile()).timezone)) return { ok: false, error: "invalid" };
    const ctx = await actionClient(expectedUnits);
    if (ctx.error) return { ok: false, error: ctx.error };

    const found = await ctx.supabase.from("shopping_item_status").select("id,name,currency,price_minor,created_at,bought_on,transaction_id").in("id", itemIds);
    if (found.error) return { ok: false, error: "failed" };
    const rows = (found.data ?? []).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id.localeCompare(b.id)));
    if (rows.length !== itemIds.length) return { ok: false, error: "conflict" };
    const currency = rows[0].currency as string;
    if (rows.some((row) => row.currency !== currency)) return { ok: false, error: "invalid" };
    // A retry finds its own earlier purchase; any other bought item means the list changed.
    if (rows.some((row) => row.bought_on !== null && row.transaction_id !== requestId)) return { ok: false, error: "conflict" };

    // Amounts are denominated by the paying balance, so it must be in the items' currency.
    const balance = await ctx.supabase.from("wallet_balances").select("currency").eq("id", balanceId).maybeSingle();
    if (balance.error) return { ok: false, error: "failed" };
    if (!balance.data || balance.data.currency !== currency) return { ok: false, error: "walletUnavailable" };

    let total: number;
    try { total = sumMinor(rows.map((row) => Number(row.price_minor))); } catch { return { ok: false, error: "invalid" }; }

    const prior = await ctx.supabase.from("transactions").select("id,revision,kind,amount_minor,deleted_at").eq("id", requestId).maybeSingle();
    if (prior.error) return { ok: false, error: "failed" };
    let purchase: TransactionMutation;
    if (prior.data) {
      if (prior.data.kind !== "expense" || prior.data.deleted_at !== null || Number(prior.data.amount_minor) !== total) return { ok: false, error: "conflict" };
      purchase = { id: prior.data.id, revision: prior.data.revision };
    } else {
      const names = rows.map((row) => row.name as string);
      const created = await createTransactionCore({
        expectedUnits, kind: "expense", occurredOn, balanceId, amountMinor: total, categoryId, note: purchaseNote(names),
        ...(rows.length > 1 ? { items: rows.map((row) => ({ description: row.name as string, amountMinor: Number(row.price_minor) })) } : {}),
      }, requestId);
      if (!created.ok) return created;
      purchase = { id: created.id, revision: created.revision };
    }

    const linked = await ctx.supabase.from("shopping_items").update({ bought_transaction_id: purchase.id }).in("id", itemIds).eq("user_id", ctx.userId).select("id");
    // The expense exists; report the unconfirmed link as retryable so the same request completes it.
    if (linked.error || linked.data?.length !== itemIds.length) return { ok: false, error: "failed" };
    revalidatePath("/", "layout");
    return { ok: true, ...purchase };
  } catch { return { ok: false, error: "failed" }; }
}
