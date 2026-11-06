import { reportingMinor } from "./amounts";
import type { Transaction } from "./schema";
import { sumMinor } from "@/lib/money";

export type DayGroup = {
  date: string;
  rows: Transaction[];
  /** Net per currency for the day. Never combined. */
  totals: Record<string, number>;
};

/** Groups newest-first rows into days. Input order is preserved. */
export function groupByDay(rows: readonly Transaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const row of rows) {
    let group = groups[groups.length - 1];
    if (!group || group.date !== row.occurredOn) {
      group = { date: row.occurredOn, rows: [], totals: {} };
      groups.push(group);
    }
    group.rows.push(row);
  }
  for (const group of groups) for (const currency of new Set<string>(group.rows.map((row) => row.currency))) {
    // Purchase cost and realized loan fees count; principal/tender/change do not.
    group.totals[currency] = sumMinor(group.rows
      .filter((row) => row.currency === currency)
      .map(reportingMinor));
  }
  return groups;
}

/**
 * Net per currency for hand-picked rows, using the same rule as the day totals
 * (purchase cost, income, realized loan fees). Currencies are never combined.
 * Moves and loan principal count for nothing, so a currency appears only when
 * at least one picked row of it counts.
 */
export function sumSelected(rows: readonly Transaction[]): Record<string, number> {
  const totals: Record<string, number> = {};
  const currencies = new Set(
    rows.filter((row) => row.kind === "income" || row.kind === "expense" || reportingMinor(row) !== 0).map((row) => row.currency),
  );
  for (const currency of currencies) {
    totals[currency] = sumMinor(rows.filter((row) => row.currency === currency).map(reportingMinor));
  }
  return totals;
}

/** Today's date as YYYY-MM-DD in the given IANA timezone. */
export function todayIn(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + delta));
  return next.toISOString().slice(0, 10);
}
