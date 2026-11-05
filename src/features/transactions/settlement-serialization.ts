import { isCurrency, readMinor, type Currency } from "@/lib/money";
import {
  cashSettlementInputSchema, validateSettlement,
  type CashSettlementInput, type SettlementRate,
} from "./settlement";

export const CASHIER_CHANGE_COLUMN_NAMES = [
  "wallet_id", "amount_minor", "currency", "position",
  "rate_base", "rate_quote", "rate_numerator", "rate_denominator",
] as const;
export const SETTLEMENT_COLUMNS =
  `tender_minor, cashier_changes!cashier_changes_transaction_owner_fkey(${CASHIER_CHANGE_COLUMN_NAMES.join(", ")})`;

export type CashierChangeRow = Record<(typeof CASHIER_CHANGE_COLUMN_NAMES)[number], unknown>;
export type SettlementRow = { tender_minor: unknown; cashier_changes: unknown };

/** Synthetic/test fixtures only; a real missing projection must still fail. */
export function emptySettlementRow(): SettlementRow {
  return { tender_minor: null, cashier_changes: [] };
}

export type SettlementChangeSnapshot = {
  walletId: string;
  amountMinor: number;
  currency: Currency;
  rate?: SettlementRate;
};
export type SettlementSnapshot = { tenderMinor: number; changes: SettlementChangeSnapshot[] };

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

function readChange(value: unknown): { position: number; change: SettlementChangeSnapshot } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SettlementSnapshotError();
  const row = value as Partial<CashierChangeRow>;
  if (CASHIER_CHANGE_COLUMN_NAMES.some((column) => !Object.hasOwn(row, column) || row[column] === undefined) ||
      typeof row.wallet_id !== "string" || !isCurrency(row.currency)) {
    throw new SettlementSnapshotError();
  }
  const position = integer(row.position);
  const amountMinor = integer(row.amount_minor);
  const rateColumns = [row.rate_base, row.rate_quote, row.rate_numerator, row.rate_denominator];
  let rate: SettlementRate | undefined;
  if (!rateColumns.every((part) => part === null)) {
    if (rateColumns.some((part) => part === null) || !isCurrency(row.rate_base) || !isCurrency(row.rate_quote)) {
      throw new SettlementSnapshotError();
    }
    rate = {
      base: row.rate_base,
      quote: row.rate_quote,
      quoteMajorNumerator: integer(row.rate_numerator),
      quoteMajorDenominator: integer(row.rate_denominator),
    };
  }
  return { position, change: { walletId: row.wallet_id, amountMinor, currency: row.currency, ...(rate ? { rate } : {}) } };
}

/** Reject missing/partial projections instead of hiding corrupt settlement data. */
export function readSettlementSnapshot(
  row: Partial<SettlementRow>,
  parent: { kind: string; currency: Currency; amountMinor: number },
): SettlementSnapshot | null {
  if (!Object.hasOwn(row, "tender_minor") || row.tender_minor === undefined ||
      !Object.hasOwn(row, "cashier_changes") || !Array.isArray(row.cashier_changes)) {
    throw new SettlementSnapshotError();
  }
  if (row.tender_minor === null) {
    if (row.cashier_changes.length > 0) throw new SettlementSnapshotError();
    return null;
  }
  if (parent.kind !== "expense") throw new SettlementSnapshotError();
  const tenderMinor = integer(row.tender_minor);
  const positioned = row.cashier_changes.map(readChange).sort((a, b) => a.position - b.position);
  if (new Set(positioned.map(({ position }) => position)).size !== positioned.length) throw new SettlementSnapshotError();
  const changes = positioned.map(({ change }) => change);
  const snapshot = { tenderMinor, changes };
  const settlement = settlementInputFromSnapshot(snapshot);
  if (!validateSettlement({
    costMinor: parent.amountMinor,
    payCurrency: parent.currency,
    changeCurrencies: changes.map(({ currency }) => currency),
    settlement,
  }).ok) throw new SettlementSnapshotError();
  return snapshot;
}

/** Drop read-only currency metadata; preserve actual minor amounts and legacy rates. */
export function settlementInputFromSnapshot(snapshot: SettlementSnapshot): CashSettlementInput {
  const parsed = cashSettlementInputSchema.safeParse({
    tenderMinor: snapshot.tenderMinor,
    changes: snapshot.changes.map(({ walletId, amountMinor, rate }) => ({
      walletId,
      amountMinor,
      ...(rate ? { rate } : {}),
    })),
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
