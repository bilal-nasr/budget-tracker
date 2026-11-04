import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClient, type ActionError, type ActionResult } from "@/lib/supabase/action";
import { categoryReferenceError } from "@/features/categories/errors";
import {
  transactionIdSchema, transactionRevisionSchema, transactionSaveArgs,
  transactionWriteInputSchema, type TransactionWriteInput,
} from "./mutation-input";

export type TransactionMutation = { id: string; revision: number };

const mutationRowsSchema = z.array(z.strictObject({
  id: transactionIdSchema,
  revision: transactionRevisionSchema,
})).length(1);

const errorMessages = new Map<string, ActionError>([
  ["pending.exceedsRemaining", "exceedsRemaining"],
  ["pending.walletUnavailable", "walletUnavailable"],
  ["pending.conflict", "conflict"],
  ["pending.invalid", "invalid"],
  ["breakdown exceeds total", "breakdownExceedsTotal"],
  ["breakdown currency locked", "breakdownCurrencyLocked"],
  ["transaction conflict", "conflict"],
  ["category unavailable", "categoryUnavailable"],
  ["wallet unavailable", "walletUnavailable"],
  ["wallet not found", "walletUnavailable"],
  ["wallet is archived", "walletUnavailable"],
  ["wallet not found or archived", "walletUnavailable"],
  ["settlement mismatch", "settlementMismatch"],
  ["settlement currency mismatch", "walletUnavailable"],
  ["unsupported currency pair", "unsupportedPair"],
  ["exceeds remaining", "exceedsRemaining"],
  ["total below paid", "totalBelowPaid"],
  ["already paid this cycle", "alreadyPaidThisCycle"],
  ["salary cycle changed", "cycleChanged"],
  ["installment payment changed", "paymentChanged"],
  ["transaction request already used", "requestAlreadyUsed"],
  ["loan.managedTransaction", "managedTransaction"],
  ["loan.conflict", "conflict"],
  ["invalid transaction input", "invalid"],
  ["invalid expense item", "invalid"],
  ["invalid settlement", "invalid"],
  ["invalid settlement rate", "invalid"],
  ["items require a live expense", "invalid"],
  ["source transaction kind cannot change", "invalid"],
]);

/** Translate only finite, known database rules. Never return database text. */
export function transactionMutationError(error: { code?: string; message?: string } | null | undefined): ActionError {
  if (error?.code === "BT001") return "breakdownExceedsTotal";
  if (error?.code === "BT002") return "breakdownCurrencyLocked";
  if (error?.code === "BT003") return "conflict";
  return categoryReferenceError(error) ?? errorMessages.get(error?.message ?? "") ??
    (error?.code === "22023" ? "invalid" : "failed");
}

/** Accept only the one mutation result for the requested aggregate. */
function mutationResult(data: unknown, expectedId: string, minimumRevision = 1): TransactionMutation | null {
  const parsed = mutationRowsSchema.safeParse(data);
  if (!parsed.success || parsed.data[0].id !== expectedId || parsed.data[0].revision < minimumRevision) return null;
  return parsed.data[0];
}

async function save(
  id: string,
  input: TransactionWriteInput,
  expectedRevision: number | null,
): Promise<ActionResult<TransactionMutation>> {
  const parsedId = transactionIdSchema.safeParse(id);
  const parsedInput = transactionWriteInputSchema.safeParse(input);
  if (!parsedId.success || !parsedInput.success ||
      (expectedRevision !== null && !transactionRevisionSchema.safeParse(expectedRevision).success)) {
    return { ok: false, error: "invalid" };
  }
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.rpc("save_transaction",
      transactionSaveArgs(parsedId.data, expectedRevision, parsedInput.data));
    if (error) return { ok: false, error: transactionMutationError(error) };
    const result = mutationResult(data, parsedId.data, expectedRevision === null ? 1 : expectedRevision + 1);
    if (!result) return { ok: false, error: "failed" };
    revalidatePath("/", "layout");
    return { ok: true, ...result };
  } catch {
    // Unknown transport outcomes are retried by the composer with the same ID;
    // this layer never guesses a current revision or generates another UUID.
    return { ok: false, error: "failed" };
  }
}

export async function createTransactionCore(
  input: TransactionWriteInput,
  draftId: string,
): Promise<ActionResult<TransactionMutation>> {
  return save(draftId, input, null);
}

export async function updateTransactionCore(
  id: string,
  input: TransactionWriteInput,
  expectedRevision: number,
): Promise<ActionResult<TransactionMutation>> {
  // Null is reserved for create. Validate before passing to the common helper,
  // including untyped/direct action callers who bypass TypeScript.
  if (!transactionRevisionSchema.safeParse(expectedRevision).success) return { ok: false, error: "invalid" };
  return save(id, input, expectedRevision);
}

async function setDeleted(
  id: string,
  expectedRevision: number,
  deleted: boolean,
): Promise<ActionResult<TransactionMutation>> {
  const parsedId = transactionIdSchema.safeParse(id);
  if (!parsedId.success || !transactionRevisionSchema.safeParse(expectedRevision).success) return { ok: false, error: "invalid" };
  try {
    const ctx = await actionClient();
    if (ctx.error) return { ok: false, error: ctx.error };
    const { data, error } = await ctx.supabase.rpc("set_transaction_deleted", {
      p_id: parsedId.data, p_expected_revision: expectedRevision, p_deleted: deleted,
    });
    if (error) return { ok: false, error: transactionMutationError(error) };
    const result = mutationResult(data, parsedId.data, expectedRevision);
    if (!result) return { ok: false, error: "failed" };
    revalidatePath("/", "layout");
    return { ok: true, ...result };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function deleteTransactionCore(id: string, expectedRevision: number): Promise<ActionResult<TransactionMutation>> {
  return setDeleted(id, expectedRevision, true);
}

export async function restoreTransactionCore(id: string, expectedRevision: number): Promise<ActionResult<TransactionMutation>> {
  return setDeleted(id, expectedRevision, false);
}
