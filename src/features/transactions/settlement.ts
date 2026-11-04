import { z } from "zod";
import { CURRENCY_DECIMALS, MAX_MINOR, MAX_RATE, type Currency } from "@/lib/money";
import { normalizeNumericDigits } from "@/lib/numeric-text";

const isCurrency = (value: unknown): value is Currency =>
  typeof value === "string" && Object.hasOwn(CURRENCY_DECIMALS, value);
const currencySchema = z.custom<Currency>(isCurrency);
const minorSchema = z.number().int().min(1).max(MAX_MINOR);

/** Canonical direct quotes only. SYP is unavailable until the shared registry includes it. */
export function settlementRatePair(from: Currency, to: Currency): { base: Currency; quote: Currency } | null {
  if (!isCurrency(from) || !isCurrency(to) || from === to) return null;
  const order = ["USD", "LBP", "SYP"];
  if (!order.includes(from) || !order.includes(to)) return null;
  return order.indexOf(from) < order.indexOf(to) ? { base: from, quote: to } : { base: to, quote: from };
}

export const settlementRateSchema = z.object({
  base: currencySchema,
  quote: currencySchema,
  quoteMajorNumerator: minorSchema,
  quoteMajorDenominator: z.number().int().min(1).max(1_000_000),
}).strict().superRefine((rate, ctx) => {
  const pair = settlementRatePair(rate.base, rate.quote);
  const { quoteMajorNumerator: n, quoteMajorDenominator: d } = rate;
  if (!pair || pair.base !== rate.base || pair.quote !== rate.quote ||
      1_000_000 % d !== 0 || BigInt(n) > 1_000_000_000n * BigInt(d) ||
      (rate.base === "USD" && rate.quote === "LBP" && (d !== 1 || n > MAX_RATE))) {
    ctx.addIssue({ code: "custom", message: "invalid settlement rate" });
  }
});
export type SettlementRate = z.infer<typeof settlementRateSchema>;
export const cashSettlementInputSchema = z.object({
  tenderMinor: minorSchema,
  change: z.object({
    walletId: z.uuid(),
    amountMinor: minorSchema,
    rate: settlementRateSchema.optional(),
  }).strict().nullable(),
}).strict();
export type CashSettlementInput = z.infer<typeof cashSettlementInputSchema>;

/** Exact decimal quote parsing; no Number division or profile-rate mutation. */
export function parseSettlementRate(text: string, from: Currency, to: Currency): SettlementRate | null {
  const pair = settlementRatePair(from, to);
  if (!pair) return null;
  const normalized = normalizeNumericDigits(text.trim())
    .replace(/٫/g, ".").replace(/[٬,\s]/g, "");
  if (!/^\d{1,10}(\.\d{1,6})?$/.test(normalized)) return null;
  if (pair.base === "USD" && pair.quote === "LBP" && normalized.includes(".")) return null;
  const [whole, fraction = ""] = normalized.split(".");
  let n = BigInt(whole + fraction);
  let d = 10n ** BigInt(fraction.length);
  let a = n; let b = d;
  while (b) { const next = a % b; a = b; b = next; }
  if (a) { n /= a; d /= a; }
  const parsed = settlementRateSchema.safeParse({ ...pair, quoteMajorNumerator: Number(n), quoteMajorDenominator: Number(d) });
  return parsed.success ? parsed.data : null;
}

/** Finite decimal text for an already validated quote, including six-place fractions. */
export function settlementRateText(rate: SettlementRate): string {
  if (!settlementRateSchema.safeParse(rate).success) return "";
  const scaled = BigInt(rate.quoteMajorNumerator) * 1_000_000n / BigInt(rate.quoteMajorDenominator);
  const fraction = String(scaled % 1_000_000n).padStart(6, "0").replace(/0+$/, "");
  return `${scaled / 1_000_000n}${fraction ? `.${fraction}` : ""}`;
}

export function convertSettlementMinor(minor: number, from: Currency, to: Currency, rate: SettlementRate): number | null {
  if (!Number.isSafeInteger(minor) || minor < 0 || minor > MAX_MINOR || !isCurrency(from) || !isCurrency(to)) return null;
  const parsed = settlementRateSchema.safeParse(rate);
  if (!parsed.success) return null;
  const pair = settlementRatePair(from, to);
  if (!pair || pair.base !== rate.base || pair.quote !== rate.quote) return null;
  const n = BigInt(rate.quoteMajorNumerator); const d = BigInt(rate.quoteMajorDenominator);
  const baseScale = 10n ** BigInt(CURRENCY_DECIMALS[rate.base]);
  const quoteScale = 10n ** BigInt(CURRENCY_DECIMALS[rate.quote]);
  const [num, den] = from === rate.base
    ? [BigInt(minor) * n * quoteScale, d * baseScale]
    : [BigInt(minor) * d * baseScale, n * quoteScale];
  const result = (2n * num + den) / (2n * den);
  return result <= BigInt(MAX_MINOR) ? Number(result) : null;
}

export type SettlementError = "amount" | "rate" | "unsupportedPair" | "mismatch";
export function validateSettlement(input: {
  costMinor: number; payCurrency: Currency; changeCurrency?: Currency; settlement: CashSettlementInput;
}): { ok: true } | { ok: false; reason: SettlementError } {
  const { costMinor, payCurrency, changeCurrency } = input;
  const parsed = cashSettlementInputSchema.safeParse(input.settlement);
  if (!parsed.success || !Number.isSafeInteger(costMinor) || costMinor < 1 || costMinor > MAX_MINOR || !isCurrency(payCurrency)) return { ok: false, reason: "amount" };
  const { tenderMinor, change } = parsed.data;
  if (tenderMinor < costMinor) return { ok: false, reason: "mismatch" };
  if (!change) return tenderMinor === costMinor ? { ok: true } : { ok: false, reason: "mismatch" };
  let value = change.amountMinor;
  if (!changeCurrency || !isCurrency(changeCurrency)) return { ok: false, reason: "unsupportedPair" };
  if (payCurrency === changeCurrency) {
    if (change.rate) return { ok: false, reason: "rate" };
  } else {
    if (!settlementRatePair(payCurrency, changeCurrency)) return { ok: false, reason: "unsupportedPair" };
    // Actual cross-currency cash movements need no manually supplied quote.
    // Older snapshots with a quote still retain their reconciliation checks.
    if (!change.rate) return tenderMinor > costMinor ? { ok: true } : { ok: false, reason: "mismatch" };
    const converted = convertSettlementMinor(value, changeCurrency, payCurrency, change.rate);
    if (converted === null) return { ok: false, reason: "rate" };
    value = converted;
  }
  return value > 0 && tenderMinor - value === costMinor ? { ok: true } : { ok: false, reason: "mismatch" };
}
