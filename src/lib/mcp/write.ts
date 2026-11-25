import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { getWallets } from "@/features/wallets/queries";
import type { ActionError } from "@/lib/supabase/action";
import { createClient } from "@/lib/supabase/server";
import { amountFormatter } from "./amounts";
import { ToolError } from "./tool";

/**
 * One fixed English sentence per action error. These are the only failure texts a write
 * tool returns; database and library text never reaches the client.
 */
export const ACTION_ERROR_TEXT: Readonly<Record<ActionError, string>> = {
  invalid: "The input is not valid for this action. Check ids, amounts (minor units), dates (YYYY-MM-DD, not in the future) and required fields.",
  notConfigured: "The budget service is not configured.",
  failed: "Could not confirm the change. Read the data to check whether it was saved before trying again.",
  hasTransactions: "This still has transactions, so it cannot be removed.",
  inUse: "This is still in use, so it cannot be removed or changed that way.",
  exceedsRemaining: "The amount is more than what remains.",
  totalBelowPaid: "The total cannot be less than what was already paid.",
  duplicateName: "Another one already has this name.",
  categoryUnavailable: "That category does not exist, is archived, or is the wrong kind (expense or income).",
  breakdownExceedsTotal: "The items add up to more than the total.",
  breakdownCurrencyLocked: "The currency cannot change while the transaction has items.",
  conflict: "The data changed since it was read. Read it again and retry with the current revision.",
  walletUnavailable: "That wallet or balance does not exist, was deleted, or its currency is disabled.",
  settlementMismatch: "The amounts paid and returned do not match the purchase.",
  unsupportedPair: "A rate between these two currencies is not supported; give the actual amounts instead.",
  alreadyPaidThisCycle: "This was already paid in the current salary cycle.",
  cycleChanged: "The salary cycle changed since it was read. Read the salary status again.",
  paymentChanged: "The installment payment changed since it was read. Read the installments again.",
  requestAlreadyUsed: "This requestId was already used for a different change. Use a new requestId.",
  loanClosed: "This loan is closed.",
  paymentOrder: "Loan payments must be removed newest first.",
  termsLocked: "The loan's terms cannot change after a payment was recorded.",
  managedTransaction: "This transaction belongs to a loan, salary, installment or fixed expense. Change it with that feature's tools.",
  duplicateCurrency: "That already exists.",
  currencyUnavailable: "That currency is not in the person's list.",
  currencyDisabled: "That currency is disabled.",
  currencyUsed: "That currency is in use.",
  currencyNonzero: "That currency still has a balance that is not zero.",
  currencyInUse: "That currency is in use.",
  lastEnabledCurrency: "At least one currency must stay enabled.",
  lastWalletBalance: "A wallet must keep at least one balance.",
  balanceUnavailable: "That balance does not exist.",
  balanceDetached: "That balance is no longer part of its wallet.",
  balanceNonzero: "That balance is not zero.",
  balanceInUse: "That balance is in use.",
  invalidDefault: "That balance cannot be the wallet's default.",
  walletDeleted: "That wallet was deleted.",
  walletNeedsAttention: "That wallet needs attention in the app before it can be used.",
  walletNonzero: "The wallet still has a balance that is not zero. Bring every balance to zero (move or adjust it) first.",
  reorderConflict: "The wallet list changed. Read the wallets again and send every wallet id in the new order.",
  deletionConflict: "The wallet changed while it was being deleted. Read the wallets again.",
  linkInvalid: "That share link is not valid.",
  limitReached: "The limit for this list was reached.",
};

/** A write whose outcome is not known (a lost response, an unexpected failure): it may or may not have been saved. */
export class UnknownOutcomeError extends ToolError {
  constructor() {
    super(ACTION_ERROR_TEXT.failed);
    this.name = "UnknownOutcomeError";
  }
}

const isActionError = (code: string): code is ActionError => Object.hasOwn(ACTION_ERROR_TEXT, code);

/**
 * The success value of an action result, or a ToolError carrying the fixed sentence for its
 * error code. `failed` (and any code this table does not know) is an unknown outcome.
 */
export function unwrap<T extends { ok: true }>(result: T | { ok: false; error: string }): T {
  if (result.ok) return result;
  if (result.error === "failed" || !isActionError(result.error)) throw new UnknownOutcomeError();
  throw new ToolError(ACTION_ERROR_TEXT[result.error]);
}

/** The optional retry key every create tool takes. */
export const requestIdSchema = z.uuid().optional().describe(
  "Optional UUID that identifies this one change. Send the same requestId when retrying after a timeout or error so the change is never made twice.",
);

export const REQUEST_REUSED_TEXT = "This requestId was already used by a different tool. Use a new requestId.";
export const REQUEST_UNKNOWN_TEXT =
  "This requestId was already used and its result was not recorded. Read the data to check whether the change was made; to try again, use a new requestId.";

/**
 * Runs a create at most once per `requestId`, for creates whose action has no request id of
 * its own. The id is claimed in `connector_requests` (the person's own row, RLS) before `run`;
 * a repeat returns the recorded result with `replayed: true` instead of running again. A
 * definite refusal (a ToolError other than an unknown outcome) releases the claim so the same
 * id can be retried; an unknown outcome keeps it, so a retry can never post twice.
 * Without a `requestId` it just runs.
 */
export async function once<T extends Record<string, unknown>>(
  tool: string,
  requestId: string | undefined,
  run: () => Promise<T>,
): Promise<T | (T & { replayed: true })> {
  if (!requestId) return run();
  const supabase = await createClient();
  const claim = await supabase.from("connector_requests").insert({ request_id: requestId, tool });
  if (claim.error) {
    if (claim.error.code !== "23505") throw new Error("Request claim failed");
    const earlier = await supabase.from("connector_requests").select("tool, result").eq("request_id", requestId).maybeSingle();
    if (earlier.error || !earlier.data) throw new Error("Request lookup failed");
    if (earlier.data.tool !== tool) throw new ToolError(REQUEST_REUSED_TEXT);
    const recorded: unknown = earlier.data.result;
    if (typeof recorded !== "object" || recorded === null || Array.isArray(recorded)) throw new ToolError(REQUEST_UNKNOWN_TEXT);
    return { ...(recorded as T), replayed: true };
  }
  let result: T;
  try {
    result = await run();
  } catch (error) {
    if (error instanceof ToolError && !(error instanceof UnknownOutcomeError)) {
      await supabase.from("connector_requests").delete().eq("request_id", requestId);
    }
    throw error;
  }
  // The change is made. If recording its result fails, a retry reports REQUEST_UNKNOWN_TEXT rather than posting again.
  await supabase.from("connector_requests").update({ result }).eq("request_id", requestId);
  return result;
}

/**
 * Current balances for a write tool's result, in the shape wallets_list uses (one amount per
 * currency, never summed). With `balanceIds`, only the wallets that hold one of them; without,
 * every wallet. Deleted wallets are included when asked for by id, so a delete can be verified.
 */
export async function balancesOut(balanceIds?: readonly string[]) {
  const [wallets, currencies] = await Promise.all([
    getWallets(balanceIds ? { includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true } : {}),
    getCurrencies(),
  ]);
  const amount = amountFormatter(currencies);
  const wanted = balanceIds ? new Set(balanceIds) : null;
  return wallets
    .filter((wallet) => !wanted || wallet.balances.some((balance) => wanted.has(balance.id)))
    .map((wallet) => ({
      ...wallet,
      balances: wallet.balances.map((balance) => ({
        ...balance,
        amount: amount(balance.balanceMinor, balance.currency),
        openingAmount: amount(balance.openingBalanceMinor, balance.currency),
      })),
    }));
}
