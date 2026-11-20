"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient } from "@/lib/supabase/action";
import { transactionMutationError } from "./mutations-core";
import { revisionRefSchema, revisionRefsSchema, type BulkTransactionResult, type RevisionRef } from "./bulk-schema";

/** Accept only a result that names exactly the requested rows, each at a plausible revision. */
function batchResult(data: unknown, requested: readonly RevisionRef[]): RevisionRef[] | null {
  const parsed = z.array(revisionRefSchema).length(requested.length).safeParse(data);
  if (!parsed.success) return null;
  const expected = new Map(requested.map((item) => [item.id, item.revision]));
  const seen = new Set<string>();
  for (const row of parsed.data) {
    const minimum = expected.get(row.id);
    if (minimum === undefined || seen.has(row.id) || row.revision < minimum) return null;
    seen.add(row.id);
  }
  return parsed.data;
}

async function run(name: string, args: Record<string, unknown>, items: unknown): Promise<BulkTransactionResult> {
  const parsed = revisionRefsSchema.safeParse(items);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    // One RPC, one statement: the database applies every row or none.
    const { data, error } = await ctx.supabase.rpc(name, { p_items: parsed.data, ...args });
    if (error) return { ok: false, error: transactionMutationError(error) };
    const result = batchResult(data, parsed.data);
    if (!result) return { ok: false, error: "failed" };
    revalidatePath("/", "layout");
    return { ok: true, items: result };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/** Soft-deletes every row or none, through the same exact-revision path as a single delete. */
export async function deleteTransactions(items: RevisionRef[]): Promise<BulkTransactionResult> {
  return run("set_transactions_deleted", { p_deleted: true }, items);
}

/** Undo for a bulk delete: pass back the rows and revisions `deleteTransactions` returned. */
export async function restoreTransactions(items: RevisionRef[]): Promise<BulkTransactionResult> {
  return run("set_transactions_deleted", { p_deleted: false }, items);
}

/** Moves plain expenses (or plain incomes) to one live category of the same kind. */
export async function setTransactionsCategory(items: RevisionRef[], categoryId: string): Promise<BulkTransactionResult> {
  if (!z.uuid().safeParse(categoryId).success) return { ok: false, error: "invalid" };
  return run("set_transactions_category", { p_category_id: categoryId }, items);
}
