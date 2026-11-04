import { MAX_MINOR, type Currency } from "@/lib/money";
import type { Transaction } from "@/features/transactions/schema";

export type SalaryReceipt = { id: string; occurredOn: string; createdAt: string };

export type InstallmentBase = {
  id: string;
  name: string;
  currency: Currency;
  walletId: string;
  categoryId: string;
  totalMinor: number;
  paidBeforeMinor: number;
  monthlyMinor: number | null;
  dueDay: number | null;
};

/** Live payments only; accounting date does not determine salary membership. */
export type InstallmentPayment = {
  /** Complete live parent for safe history/detail/edit; never used for sums. */
  transaction?: Transaction;
  transactionId: string;
  amountMinor: number;
  occurredOn: string;
  createdAt: string;
  walletId: string;
  salaryCycleId: string | null;
  revision: number;
};

export type Installment = InstallmentBase & {
  paidMinor: number;
  remainingMinor: number;
  salaryCycleId: string | null;
  paidThisCycleMinor: number;
  cyclePaymentCount: number;
  cycleLatestPaymentId: string | null;
  cycleStatus: "unpaid" | "partial" | "paid" | "paidOff";
  /** Recording order, newest first. Never sorted by editable accounting date. */
  payments: InstallmentPayment[];
};

type CycleAmounts = Pick<Installment, "monthlyMinor" | "remainingMinor" | "paidThisCycleMinor">;

/** Planned amount, including a final payment already made in this cycle. */
export function dueThisCycle(i: CycleAmounts): number {
  return i.monthlyMinor === null ? 0 : Math.min(i.monthlyMinor, i.remainingMinor + i.paidThisCycleMinor);
}

export function canPayNormally(i: Pick<Installment, "remainingMinor" | "cyclePaymentCount">): boolean {
  return i.remainingMinor > 0 && i.cyclePaymentCount === 0;
}

/** A deliberate repeat first suggests finishing a partial scheduled amount. */
export function paymentAmountDefault(i: CycleAmounts): number {
  if (i.remainingMinor <= 0) return 0;
  const unfinished = dueThisCycle(i) - i.paidThisCycleMinor;
  return Math.min(unfinished > 0 ? unfinished : (i.monthlyMinor ?? i.remainingMinor), i.remainingMinor);
}

function minor(value: number, minimum: number): bigint {
  if (!Number.isSafeInteger(value) || value < minimum || value > MAX_MINOR) {
    throw new RangeError("Invalid installment amount");
  }
  return BigInt(value);
}

/** Preserve PostgreSQL's microseconds when two payments share a millisecond. */
function recordedMicros(value: string): bigint {
  const millis = Date.parse(value);
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/)?.[1] ?? "";
  if (!Number.isFinite(millis) || fraction.length > 6) throw new RangeError("Invalid payment recording time");
  return BigInt(millis) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3));
}

/** Principal is lifetime progress; current receipt membership is a separate sum. */
export function withProgress(
  base: InstallmentBase,
  payments: readonly InstallmentPayment[],
  salaryCycleId: string | null,
): Installment {
  const total = minor(base.totalMinor, 1);
  let paid = minor(base.paidBeforeMinor, 0);
  if (base.monthlyMinor !== null) minor(base.monthlyMinor, 1);
  let paidInCycle = 0n;
  let cyclePaymentCount = 0;
  const seen = new Set<string>();
  const ordered = payments.map((p) => {
    if (seen.has(p.transactionId)) throw new RangeError("Duplicate installment payment");
    seen.add(p.transactionId);
    const amount = minor(p.amountMinor, 1);
    paid += amount;
    if (p.salaryCycleId === salaryCycleId) {
      paidInCycle += amount;
      cyclePaymentCount++;
    }
    return { payment: p, micros: recordedMicros(p.createdAt) };
  }).sort((a, b) => {
    if (a.micros !== b.micros) return a.micros > b.micros ? -1 : 1;
    return a.payment.transactionId === b.payment.transactionId ? 0 : a.payment.transactionId > b.payment.transactionId ? -1 : 1;
  }).map(({ payment }) => payment);
  if (paid > total) throw new RangeError("Installment exceeds total principal");
  const progress = {
    ...base,
    paidMinor: Number(paid),
    remainingMinor: Number(total - paid),
    salaryCycleId,
    paidThisCycleMinor: Number(paidInCycle),
    cyclePaymentCount,
    cycleLatestPaymentId: ordered.find((p) => p.salaryCycleId === salaryCycleId)?.transactionId ?? null,
    payments: ordered,
  };
  const cycleStatus: Installment["cycleStatus"] = progress.remainingMinor === 0 ? "paidOff"
    : cyclePaymentCount === 0 ? "unpaid"
    : paidInCycle < BigInt(dueThisCycle(progress)) ? "partial" : "paid";
  return { ...progress, cycleStatus };
}
