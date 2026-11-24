import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool } from "@/lib/mcp/tool";
import { getPendingPayments, getPendingReceipts } from "./queries";

export const pendingPaymentTools = [
  defineTool({
    name: "pending_payments_list",
    title: "List pending payments",
    description:
      "List money other people owe the person for jobs (client and project): the agreed total, what has been received and what is still `remaining`, with the due date. " +
      "Each job has one currency. Use pending_payments_receipts with a job id for its individual receipts.",
    kind: "read",
    run: async () => {
      const [jobs, currencies] = await Promise.all([getPendingPayments(), getCurrencies()]);
      const amount = amountFormatter(currencies);
      return {
        payments: jobs.map((job) => ({
          ...job,
          total: amount(job.totalMinor, job.currency),
          received: amount(job.receivedMinor, job.currency),
          remaining: amount(job.remainingMinor, job.currency),
        })),
      };
    },
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
      const currency = jobs.find((job) => job.id === paymentId)?.currency;
      return { receipts: receipts.map((receipt) => (currency ? { ...receipt, amount: amount(receipt.amountMinor, currency) } : receipt)) };
    },
  }),
];
