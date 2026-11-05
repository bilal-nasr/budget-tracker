import { addDays } from "@/features/transactions/group";

/** A pay cycle: from one salary receipt date up to (not including) the next. `to` is null while it is still open. */
export type SpendCycle = { from: string; to: string | null };

/** Newest first. Receipt dates repeated on one day make one cycle start. */
export function buildCycles(receiptDates: readonly string[]): SpendCycle[] {
  const days = [...new Set(receiptDates)].sort();
  return days.map((from, index) => ({ from, to: days[index + 1] ?? null })).reverse();
}

/** The requested cycle by its start date, else the newest; null when there are no salary receipts. */
export function pickCycle(cycles: readonly SpendCycle[], requestedFrom: string | null): SpendCycle | null {
  return cycles.find((cycle) => cycle.from === requestedFrom) ?? cycles[0] ?? null;
}

/** Older and newer neighbours of a cycle, as start dates. */
export function neighbours(cycles: readonly SpendCycle[], cycle: SpendCycle): { older: string | null; newer: string | null } {
  const index = cycles.findIndex((item) => item.from === cycle.from);
  return { older: cycles[index + 1]?.from ?? null, newer: index > 0 ? cycles[index - 1].from : null };
}

/** Inclusive day range for Activity filters. */
export function cycleDays(cycle: SpendCycle, today: string): { from: string; to: string } {
  return { from: cycle.from, to: cycle.to ? addDays(cycle.to, -1) : today };
}
