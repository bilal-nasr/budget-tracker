"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient, type ActionError, type ActionResult } from "@/lib/supabase/action";
import { getProfile } from "@/features/profile/queries";
import { todayIn } from "@/features/transactions/group";
import { pendingPaymentSchema, receiptSchema, type PendingPaymentInput, type ReceiptInput } from "./schema";

async function mutate(name: string, args: Record<string, unknown>, withId: true): Promise<ActionResult<{ id: string }>>;
async function mutate(name: string, args: Record<string, unknown>, withId?: false): Promise<ActionResult>;
async function mutate(name: string, args: Record<string, unknown>, withId = false): Promise<ActionResult<{ id?: string }>> {
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.rpc(name, args);
    if (error) {
      const known: ActionError[] = ["invalid", "conflict", "exceedsRemaining", "totalBelowPaid", "inUse", "walletUnavailable", "categoryUnavailable"];
      return { ok: false, error: known.find((code) => error.message === `pending.${code}`) ?? "failed" };
    }
    const id = withId ? z.uuid().safeParse(Array.isArray(data) && data.length === 1 ? data[0]?.id : null) : null;
    if (id && !id.success) return { ok: false, error: "failed" };
    revalidatePath("/", "layout");
    return id?.success ? { ok: true, id: id.data } : { ok: true };
  } catch { return { ok: false, error: "failed" }; }
}

export async function createPendingPayment(input: PendingPaymentInput): Promise<ActionResult<{ id: string }>> {
  const parsed = pendingPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return mutate("create_pending_payment", { p_input: parsed.data }, true);
}
export async function recordPendingReceipt(input: ReceiptInput): Promise<ActionResult<{ id: string }>> {
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success || parsed.data.occurredOn > todayIn((await getProfile()).timezone)) return { ok: false, error: "invalid" };
  return mutate("record_pending_receipt", { p_input: parsed.data }, true);
}
export async function updatePendingPayment(id: string, revision: number, input: PendingPaymentInput): Promise<ActionResult> {
  const parsed = pendingPaymentSchema.safeParse(input);
  if (!z.uuid().safeParse(id).success || !z.number().int().positive().safeParse(revision).success || !parsed.success) return { ok: false, error: "invalid" };
  return mutate("update_pending_payment", { p_id: id, p_revision: revision, p_input: parsed.data });
}
export async function deletePendingPayment(id: string, revision: number): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success || !z.number().int().positive().safeParse(revision).success) return { ok: false, error: "invalid" };
  return mutate("update_pending_payment", { p_id: id, p_revision: revision, p_input: {}, p_delete: true });
}
