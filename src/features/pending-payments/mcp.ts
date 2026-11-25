import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { getProfile } from "@/features/profile/queries";
import { todayIn } from "@/features/transactions/group";
import { currencyIntent } from "@/lib/currency-intent";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool, ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT, balancesOut, requestIdSchema, unwrap } from "@/lib/mcp/write";
import { createPendingPayment, deletePendingPayment, recordPendingReceipt, updatePendingPayment } from "./actions";
import { getPendingPayments, getPendingReceipts } from "./queries";
import { pendingPaymentSchema, receiptSchema, type PendingPayment, type PendingReceipt } from "./schema";

type Amount = ReturnType<typeof amountFormatter>;

const NOT_FOUND = "That pending payment does not exist. Use pending_payments_list to find its id.";
const NOT_READ_BACK = "The change was saved but the pending payment could not be read back. Read pending_payments_list to see it.";
const DELETE_REFUSED = "This pending payment has received money (a receipt, even a removed one), so it cannot be deleted.";

/** A job as pending_payments_list gives it. */
const paymentOut = (job: PendingPayment, amount: Amount) => ({
  ...job,
  total: amount(job.totalMinor, job.currency),
  received: amount(job.receivedMinor, job.currency),
  remaining: amount(job.remainingMinor, job.currency),
});

/** A receipt as pending_payments_receipts gives it; without the job's currency it stays raw. */
const receiptOut = (receipt: PendingReceipt, currency: string | undefined, amount: Amount) =>
  currency ? { ...receipt, amount: amount(receipt.amountMinor, currency) } : receipt;

async function paymentsOut() {
  const [jobs, currencies] = await Promise.all([getPendingPayments(), getCurrencies()]);
  const amount = amountFormatter(currencies);
  return jobs.map((job) => paymentOut(job, amount));
}

async function paymentOutById(id: string) {
  const job = (await paymentsOut()).find((item) => item.id === id);
  if (!job) throw new ToolError(NOT_READ_BACK);
  return job;
}

async function currentPayment(id: string): Promise<PendingPayment> {
  const job = (await getPendingPayments()).find((item) => item.id === id);
  if (!job) throw new ToolError(NOT_FOUND);
  return job;
}

/** Currency-intent header for the job's currency, built the way the payment and receipt sheets build it. */
async function intentForCurrency(code: string) {
  const definition = (await getCurrencies()).find((currency) => currency.code === code);
  if (!definition) throw new ToolError(ACTION_ERROR_TEXT.currencyUnavailable);
  if (definition.disabled) throw new ToolError(ACTION_ERROR_TEXT.currencyDisabled);
  return currencyIntent(definition);
}

const job = pendingPaymentSchema.shape;
const receipt = receiptSchema.shape;
const idField = z.uuid().describe("Pending payment (job) id from pending_payments_list.");
const revisionField = z.number().int().positive().describe("The job's current `revision` from pending_payments_list (or a previous write's result); a stale one is refused.");
const clientField = job.client.describe("Client name, 1 to 60 characters.");
const projectField = job.project.describe("Project or job name, 1 to 60 characters.");
const totalField = job.totalMinor.describe("Agreed total in integer minor units of the job's currency (for example cents), at least 1.");
const dueField = job.dueOn.describe("Due date as YYYY-MM-DD, or null for none.");

export const pendingPaymentTools = [
  defineTool({
    name: "pending_payments_list",
    title: "List pending payments",
    description:
      "List money other people owe the person for jobs (client and project): the agreed total, what has been received and what is still `remaining`, with the due date. " +
      "Each job has one currency. Use pending_payments_receipts with a job id for its individual receipts.",
    kind: "read",
    run: async () => ({ payments: await paymentsOut() }),
  }),
  defineTool({
    name: "pending_payments_receipts",
    title: "Pending payment receipts",
    description:
      "List the receipts (partial payments received) of one pending-payment job, newest first. " +
      "Get `paymentId` from pending_payments_list; every receipt is in that job's currency.",
    kind: "read",
    input: z.object({ paymentId: z.uuid() }),
    run: async ({ paymentId }) => {
      const [receipts, jobs, currencies] = await Promise.all([getPendingReceipts(paymentId), getPendingPayments(), getCurrencies()]);
      const amount = amountFormatter(currencies);
      // Receipts are always recorded in the job's currency; without the job they stay raw.
      const currency = jobs.find((item) => item.id === paymentId)?.currency;
      return { receipts: receipts.map((item) => receiptOut(item, currency, amount)) };
    },
  }),
  defineTool({
    name: "pending_payments_create",
    title: "Create pending payment",
    description:
      "Add a job someone owes the person money for (client, project, agreed total, optional due date). This records no money: receipts do, with pending_payments_record_receipt. " +
      "`currency` is a code from currencies_list and cannot change later; `totalMinor` is integer minor units of it. " +
      "Returns { payment } in the shape pending_payments_list gives. " +
      "Send a requestId and reuse it with exactly the same values when retrying: the same job is returned instead of a second one.",
    kind: "write",
    input: z.strictObject({
      requestId: requestIdSchema,
      client: clientField,
      project: projectField,
      currency: job.currency.describe("Currency code from currencies_list, for example USD."),
      totalMinor: totalField,
      dueOn: dueField.optional(),
    }),
    run: async ({ requestId, client, project, currency, totalMinor, dueOn }) => {
      const created = unwrap<{ ok: true; id: string }>(await createPendingPayment({
        expectedUnits: await intentForCurrency(currency),
        requestId: requestId ?? crypto.randomUUID(),
        client,
        project,
        currency,
        totalMinor,
        dueOn: dueOn ?? null,
      }));
      return { payment: await paymentOutById(created.id) };
    },
  }),
  defineTool({
    name: "pending_payments_update",
    title: "Update pending payment",
    description:
      "Change a job's client, project, agreed total or due date. Id and current revision come from pending_payments_list; fields you leave out keep their current value (dueOn: null clears it). " +
      "The currency cannot change. `totalMinor` is integer minor units of the job's currency and cannot be less than what was already received. " +
      "Returns { payment } in the shape pending_payments_list gives, with its new revision.",
    kind: "write",
    input: z.strictObject({
      id: idField,
      revision: revisionField,
      client: clientField.optional(),
      project: projectField.optional(),
      totalMinor: totalField.optional(),
      dueOn: dueField.optional(),
    }),
    run: async ({ id, revision, client, project, totalMinor, dueOn }) => {
      const current = await currentPayment(id);
      unwrap(await updatePendingPayment(id, revision, {
        expectedUnits: await intentForCurrency(current.currency),
        // The update ignores it; the shared input schema requires one.
        requestId: crypto.randomUUID(),
        client: client ?? current.client,
        project: project ?? current.project,
        currency: current.currency,
        totalMinor: totalMinor ?? current.totalMinor,
        dueOn: dueOn === undefined ? current.dueOn : dueOn,
      }));
      return { payment: await paymentOutById(id) };
    },
  }),
  defineTool({
    name: "pending_payments_delete",
    title: "Delete pending payment",
    description:
      "Delete a job that never received any money. A job with a receipt (even one that was later removed) is refused. Moves no money. " +
      "Id and current revision come from pending_payments_list. Returns { deleted: true, id }.",
    kind: "destructive",
    input: z.strictObject({ id: idField, revision: revisionField }),
    run: async ({ id, revision }) => {
      await currentPayment(id);
      const result = await deletePendingPayment(id, revision);
      if (!result.ok && result.error === "inUse") throw new ToolError(DELETE_REFUSED);
      unwrap(result);
      return { deleted: true, id };
    },
  }),
  defineTool({
    name: "pending_payments_record_receipt",
    title: "Record pending payment receipt",
    description:
      "Mark money received for a job: records income of `amountMinor` into a wallet balance and counts it toward the job. " +
      "Job id from pending_payments_list, balance id from wallets_list (a balance in the job's currency), income category id from categories_list. " +
      "`amountMinor` is integer minor units of the job's currency and at most the job's `remaining`; to mark the job fully paid, send its `remainingMinor` from pending_payments_list. " +
      "Returns { payment } (pending_payments_list shape), { receipt } (pending_payments_receipts shape) and the affected `balances`. " +
      "Send a requestId and reuse it with exactly the same values when retrying: the same receipt is returned instead of a second one.",
    kind: "write",
    input: z.strictObject({
      requestId: requestIdSchema,
      paymentId: idField,
      balanceId: receipt.balanceId.describe("Wallet balance id from wallets_list (balances[].id) that receives the money, in the job's currency."),
      categoryId: receipt.categoryId.describe("Income category id from categories_list."),
      amountMinor: receipt.amountMinor.describe("Amount received in integer minor units of the job's currency, at least 1 and at most what remains."),
      occurredOn: receipt.occurredOn.optional().describe("Day the money arrived as YYYY-MM-DD, not in the future. Defaults to today in the person's time zone."),
    }),
    run: async ({ requestId, paymentId, balanceId, categoryId, amountMinor, occurredOn }) => {
      const current = await currentPayment(paymentId);
      const recorded = unwrap<{ ok: true; id: string }>(await recordPendingReceipt({
        expectedUnits: await intentForCurrency(current.currency),
        requestId: requestId ?? crypto.randomUUID(),
        paymentId,
        balanceId,
        categoryId,
        amountMinor,
        occurredOn: occurredOn ?? todayIn((await getProfile()).timezone),
      }));
      const [payment, receipts, currencies] = await Promise.all([paymentOutById(paymentId), getPendingReceipts(paymentId), getCurrencies()]);
      const found = receipts.find((item) => item.id === recorded.id);
      return {
        payment,
        // A replayed receipt that was removed since is acknowledged but no longer listed.
        receipt: found ? receiptOut(found, payment.currency, amountFormatter(currencies)) : null,
        balances: await balancesOut([found?.balanceId ?? balanceId]),
      };
    },
  }),
];
