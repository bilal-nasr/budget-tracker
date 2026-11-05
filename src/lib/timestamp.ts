/** Compare PostgreSQL instants without losing its three submillisecond digits. */
export function compareTimestamps(left: string, right: string): number {
  const leftMillis = Date.parse(left);
  const rightMillis = Date.parse(right);
  if (!Number.isFinite(leftMillis) || !Number.isFinite(rightMillis)) throw new RangeError("Invalid timestamp");
  if (leftMillis !== rightMillis) return leftMillis - rightMillis;
  const micros = (value: string) => {
    const fraction = value.match(/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "";
    return Number(fraction.padEnd(6, "0").slice(3));
  };
  return micros(left) - micros(right);
}
