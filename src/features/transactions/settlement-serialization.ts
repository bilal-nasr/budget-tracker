import { currencyCodeSchema } from "@/features/currencies/schema";
const isCurrency = (value: unknown): value is string => currencyCodeSchema.safeParse(value).success;
import { readMinor } from "@/lib/money";
import {
  cashSettlementInputSchema, validateSettlement,
  type CashSettlementInput, type SettlementRate,
} from "./settlement";

export const CASHIER_CHANGE_COLUMN_NAMES = [
  "balance_id", "amount_minor", "currency", "position", "leg", "wallet_name_snapshot",
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
  balanceId: string;
  /** Immutable receiver name captured by the database, never accepted in a write. */
  walletNameSnapshot?: string | null;
  amountMinor: number;
  currency: string;
  rate?: SettlementRate;
};
/** One additional tender line: an exact amount handed over from another balance. */
export type SettlementTenderSnapshot = {
  balanceId: string;
  /** Immutable payer name captured by the database, never accepted in a write. */
  walletNameSnapshot?: string | null;
  amountMinor: number;
  currency: string;
};
export type SettlementSnapshot = {
  /** First tender line: debited from the transaction's own paying balance. */
  tenderMinor: number; tenderCurrency: string;
  /** Further tender lines in entry order. Absent means the purchase had one tender. */
  extraTenders?: SettlementTenderSnapshot[];
  changes: SettlementChangeSnapshot[];
};

/** Every tender line in entry order; the first is the transaction's paying balance. */
export function settlementTenders(
  snapshot: SettlementSnapshot,
  payer: { balanceId: string; walletNameSnapshot?: string | null },
): SettlementTenderSnapshot[] {
  return [
    { balanceId: payer.balanceId, walletNameSnapshot: payer.walletNameSnapshot ?? null, amountMinor: snapshot.tenderMinor, currency: snapshot.tenderCurrency },
    ...(snapshot.extraTenders ?? []),
  ];
}

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

function readChange(value: unknown): { position: number; leg: "change" | "tender"; change: SettlementChangeSnapshot } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SettlementSnapshotError();
  const row = value as Partial<CashierChangeRow>;
  if (CASHIER_CHANGE_COLUMN_NAMES.some((column) => !Object.hasOwn(row, column) || row[column] === undefined) ||
      typeof row.balance_id !== "string" || !isCurrency(row.currency) || (row.wallet_name_snapshot !== null && typeof row.wallet_name_snapshot !== "string") ||
      (row.leg !== "change" && row.leg !== "tender")) {
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
  // A tender line is a recorded fact only; it never carries rate metadata.
  if (row.leg === "tender" && rate) throw new SettlementSnapshotError();
  return { position, leg: row.leg, change: { balanceId: row.balance_id, ...(row.wallet_name_snapshot === null ? {} : { walletNameSnapshot: row.wallet_name_snapshot as string }), amountMinor, currency: row.currency, ...(rate ? { rate } : {}) } };
}

/** Reject missing/partial projections instead of hiding corrupt settlement data. */
export function readSettlementSnapshot(
  row: Partial<SettlementRow>,
  parent: { kind: string; costCurrency: string; payCurrency: string; amountMinor: number },
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
  const changes = positioned.filter(({ leg }) => leg === "change").map(({ change }) => change);
  const extraTenders: SettlementTenderSnapshot[] = positioned.filter(({ leg }) => leg === "tender")
    .map(({ change: { balanceId, walletNameSnapshot, amountMinor, currency } }) =>
      ({ balanceId, ...(walletNameSnapshot === undefined ? {} : { walletNameSnapshot }), amountMinor, currency }));
  const snapshot: SettlementSnapshot = {
    tenderMinor, tenderCurrency: parent.payCurrency, ...(extraTenders.length ? { extraTenders } : {}), changes,
  };
  const settlement = settlementInputFromSnapshot(snapshot);
  if (!validateSettlement({
    costMinor: parent.amountMinor,
    costCurrency: parent.costCurrency,
    payCurrency: parent.payCurrency,
    changeCurrencies: changes.map(({ currency }) => currency),
    extraTenderCurrencies: extraTenders.map(({ currency }) => currency),
    settlement,
  }).ok) throw new SettlementSnapshotError();
  return snapshot;
}

/** Drop read-only currency metadata; preserve actual minor amounts and legacy rates. */
export function settlementInputFromSnapshot(snapshot: SettlementSnapshot): CashSettlementInput {
  const parsed = cashSettlementInputSchema.safeParse({
    tenderMinor: snapshot.tenderMinor,
    ...(snapshot.extraTenders?.length
      ? { extraTenders: snapshot.extraTenders.map(({ balanceId, amountMinor }) => ({ balanceId, amountMinor })) }
      : {}),
    changes: snapshot.changes.map(({ balanceId: balanceId, amountMinor, rate }) => ({
      balanceId,
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
