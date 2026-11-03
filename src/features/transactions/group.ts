import { signedMinor, type Transaction } from "./schema";

export type DayGroup = {
  date: string;
  rows: Transaction[];
  /** Net per currency for the day. Never combined. */
  totals: { USD: number; LBP: number };
};

/** Groups newest-first rows into days. Input order is preserved. */
export function groupByDay(rows: readonly Transaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const row of rows) {
    let group = groups[groups.length - 1];
    if (!group || group.date !== row.occurredOn) {
      group = { date: row.occurredOn, rows: [], totals: { USD: 0, LBP: 0 } };
      groups.push(group);
    }
    group.rows.push(row);
    group.totals[row.currency] += signedMinor(row);
  }
  return groups;
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
