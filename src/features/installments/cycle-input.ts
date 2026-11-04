import { z } from "zod";
import { MAX_MINOR } from "@/lib/money";

// PostgreSQL serializes UUIDs in lowercase; normalize the same identity before
// comparing an idempotent RPC result with a caller's retained request UUID.
const uuid = z.uuid().transform((value) => value.toLowerCase());

/** Required UUIDs belong to one retained UI intent, never generated per retry. */
export const receiveSalaryInputSchema = z.strictObject({
  requestId: uuid,
  expectedCycleId: uuid.nullable(),
});
export type ReceiveSalaryInput = z.infer<typeof receiveSalaryInputSchema>;

export const cyclePaymentInputSchema = z.strictObject({
  requestId: uuid,
  installmentId: uuid,
  walletId: uuid,
  amountMinor: z.number().int().min(1).max(MAX_MINOR),
  occurredOn: z.iso.date().refine((date) => date >= "2000-01-01"),
  salaryCycleId: uuid.nullable(),
  /** Latest live payment explicitly acknowledged by Pay again; null for Pay. */
  overrideOfTransactionId: uuid.nullable(),
});
export type CyclePaymentInput = z.infer<typeof cyclePaymentInputSchema>;

export const cycleMutationSchema = z.strictObject({
  id: uuid,
  revision: z.number().int().min(1).max(2_147_483_647),
});
export type CycleMutation = z.infer<typeof cycleMutationSchema>;
