import { expectedUnitsSchema } from "@/lib/currency-intent";
import { z } from "zod";
import { MAX_MINOR } from "@/lib/money";
import { expenseItemInputSchema, MAX_EXPENSE_ITEMS, summarizeBreakdown } from "./breakdown";
import { cashSettlementInputSchema } from "./settlement";
import { serializeSettlement } from "./settlement-serialization";

/** Shared by the isolated write core and the eventual public schema reexport. */
export const transactionIdSchema = z.uuid().transform((id) => id.toLowerCase());
export const transactionRevisionSchema = z.number().int().min(1).max(2_147_483_647);

export const transactionWriteInputSchema = z.strictObject({
  expectedUnits: expectedUnitsSchema.optional(),
  kind: z.enum(["expense", "income"]),
  occurredOn: z.iso.date().refine((date) => date >= "2000-01-01"),
  /** Exact durable balance identity. */
  balanceId: transactionIdSchema,
  amountMinor: z.number().int().min(1).max(MAX_MINOR),
  /** Omitted on update preserves the stored purchase denomination. */
  costCurrency: z.string().regex(/^[A-Z][A-Z0-9]{0,11}$/).optional(),
  categoryId: transactionIdSchema,
  note: z.string().trim().max(140).optional(),
  items: z.array(expenseItemInputSchema).max(MAX_EXPENSE_ITEMS).optional(),
  /** Omitted = preserve on update; explicit null = clear. */
  settlement: cashSettlementInputSchema.nullable().optional(),
}).superRefine((input, ctx) => {
  if (input.kind !== "expense" && ((input.items?.length ?? 0) > 0 || input.settlement != null)) {
    ctx.addIssue({ code: "custom", message: "Only expenses can have items or settlement" });
  }
  if (input.items && !summarizeBreakdown(input.amountMinor, input.items).valid) {
    ctx.addIssue({ code: "custom", path: ["items"], message: "Items exceed the parent cost" });
  }
});

export type TransactionWriteInput = z.infer<typeof transactionWriteInputSchema>;
export type TransactionSaveArgs = {
  p_id: string;
  p_expected_revision: number | null;
  p_input: {
    kind: "expense" | "income";
    occurredOn: string;
    balanceId: string;
    amountMinor: number;
    costCurrency?: TransactionWriteInput["costCurrency"];
    categoryId: string;
    note: string | null;
  };
  p_items: NonNullable<TransactionWriteInput["items"]> | null;
  p_settlement: { tenderMinor: number; changes: { balanceId: string; amountMinor: number; rate?: unknown }[] } | Record<string, never> | null;
};

/** One payload mapping; call only after the schema above has validated input. */
export function transactionSaveArgs(
  id: string,
  expectedRevision: number | null,
  input: TransactionWriteInput,
): TransactionSaveArgs {
  const { kind, occurredOn, balanceId, amountMinor, costCurrency, categoryId, note, items, settlement } = input;
  return {
    p_id: id,
    p_expected_revision: expectedRevision,
    p_input: { kind, occurredOn, balanceId, amountMinor, ...(costCurrency ? { costCurrency } : {}), categoryId, note: note || null },
    p_items: items ?? null,
    p_settlement: (() => {
      const serialized = serializeSettlement(settlement);
      if (!serialized || !("tenderMinor" in serialized) || !("changes" in serialized)) return serialized;
      return { tenderMinor: serialized.tenderMinor, changes: serialized.changes };
    })(),
  };
}
