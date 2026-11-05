import type { CurrencyDefinition } from "@/lib/currency";
import { MAX_MINOR, MAX_RATE } from "@/lib/money";
/** Only the explicitly supported USD/LBP reference quote can calculate received. */
export function convertTransferAtRate(sentMinor: number, source: CurrencyDefinition, destination: CurrencyDefinition, rate: number): number | null {
  if (!((source.code === "USD" && destination.code === "LBP") || (source.code === "LBP" && destination.code === "USD")) ||
      !Number.isSafeInteger(sentMinor) || sentMinor < 0 || sentMinor > MAX_MINOR ||
      !Number.isSafeInteger(rate) || rate < 1 || rate > MAX_RATE) return null;
  const sourceScale = 10n ** BigInt(source.decimalPlaces);
  const destinationScale = 10n ** BigInt(destination.decimalPlaces);
  const numerator = BigInt(sentMinor) * destinationScale * (source.code === "USD" ? BigInt(rate) : 1n);
  const denominator = sourceScale * (source.code === "LBP" ? BigInt(rate) : 1n);
  const result = (2n * numerator + denominator) / (2n * denominator);
  return result <= BigInt(MAX_MINOR) ? Number(result) : null;
}
