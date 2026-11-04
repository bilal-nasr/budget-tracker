import { isCurrency, readMinor, type Currency } from "@/lib/money";
import {
  cashSettlementInputSchema, validateSettlement,
  type CashSettlementInput, type SettlementRate,
} from "./settlement";

export const SETTLEMENT_COLUMN_NAMES = [
  "tender_minor", "change_wallet_id", "change_minor", "change_currency",
  "change_rate_base", "change_rate_quote", "change_rate_numerator", "change_rate_denominator",
] as const;
export const SETTLEMENT_COLUMNS = SETTLEMENT_COLUMN_NAMES.join(", ");
/** Unknown values deliberately remain unknown until checked at the read boundary. */
export type SettlementRow = Record<(typeof SETTLEMENT_COLUMN_NAMES)[number], unknown>;
/** Synthetic/test fixtures only; a real missing projection must still fail. */
export function emptySettlementRow(): SettlementRow {
  return {
    tender_minor: null, change_wallet_id: null, change_minor: null, change_currency: null,
    change_rate_base: null, change_rate_quote: null, change_rate_numerator: null, change_rate_denominator: null,
  };
}
export type SettlementSnapshot = {
  tenderMinor: number;
  change: null | { walletId: string; amountMinor: number; currency: Currency; rate?: SettlementRate };
};
export class SettlementSnapshotError extends Error {
  constructor() {
    super("Invalid settlement snapshot");
    this.name = "SettlementSnapshotError";
  }
}

function integer(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") throw new SettlementSnapshotError();
  try {
    return readMinor(value);
  } catch {
    throw new SettlementSnapshotError();
  }
}

/**
 * Reject a missing projection, partial shape, invalid integer or inconsistent
 * equation instead of displaying a corrupt settlement as an ordinary expense.
 * The caller has already decoded the parent cost with readMinor.
 */
export function readSettlementSnapshot(
  row: Partial<SettlementRow>,
  parent: { kind: string; currency: Currency; amountMinor: number },
): SettlementSnapshot | null {
  if (SETTLEMENT_COLUMN_NAMES.some((column) => !Object.hasOwn(row, column) || row[column] === undefined)) {
    throw new SettlementSnapshotError();
  }
  if (SETTLEMENT_COLUMN_NAMES.every((column) => row[column] === null)) return null;
  if (parent.kind !== "expense" || row.tender_minor === null) throw new SettlementSnapshotError();
  const tenderMinor = integer(row.tender_minor);
  let change: SettlementSnapshot["change"] = null;
  if (row.change_wallet_id === null) {
    if (SETTLEMENT_COLUMN_NAMES.slice(2).some((column) => row[column] !== null)) throw new SettlementSnapshotError();
  } else {
    if (typeof row.change_wallet_id !== "string" || !isCurrency(row.change_currency)) throw new SettlementSnapshotError();
    const amountMinor = integer(row.change_minor);
    const rateColumns = [row.change_rate_base, row.change_rate_quote, row.change_rate_numerator, row.change_rate_denominator];
    let rate: SettlementRate | undefined;
    if (!rateColumns.every((value) => value === null)) {
      if (rateColumns.some((value) => value === null) || !isCurrency(row.change_rate_base) || !isCurrency(row.change_rate_quote)) throw new SettlementSnapshotError();
      rate = {
        base: row.change_rate_base, quote: row.change_rate_quote,
        quoteMajorNumerator: integer(row.change_rate_numerator),
        quoteMajorDenominator: integer(row.change_rate_denominator),
      };
    }
    change = { walletId: row.change_wallet_id, amountMinor, currency: row.change_currency, ...(rate ? { rate } : {}) };
  }
  const snapshot = { tenderMinor, change };
  const input = settlementInputFromSnapshot(snapshot);
  if (!validateSettlement({ costMinor: parent.amountMinor, payCurrency: parent.currency, changeCurrency: change?.currency, settlement: input }).ok) {
    throw new SettlementSnapshotError();
  }
  return snapshot;
}

/** Drop only read-only currency metadata; preserve actual minor amounts/rate. */
export function settlementInputFromSnapshot(snapshot: SettlementSnapshot): CashSettlementInput {
  const { tenderMinor, change } = snapshot;
  const parsed = cashSettlementInputSchema.safeParse({
    tenderMinor,
    change: change === null ? null : {
      walletId: change.walletId, amountMinor: change.amountMinor,
      ...(change.rate ? { rate: change.rate } : {}),
    },
  });
  if (!parsed.success) throw new SettlementSnapshotError();
  return parsed.data;
}

/** SQL null preserves on edit; {} explicitly removes; object replaces. */
export function serializeSettlement(
  input: CashSettlementInput | null | undefined,
): CashSettlementInput | Record<string, never> | null {
  if (input === undefined) return null;
  if (input === null) return {};
  return cashSettlementInputSchema.parse(input);
}
