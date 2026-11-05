import { normalizeNumericDigits } from "@/lib/numeric-text";
import { DEFAULT_CURRENCIES, MAX_MINOR, MAX_RATE, isCurrency, requireCurrency, type Currency, type CurrencyDefinition } from "./currency";

export {
  CURRENCIES, CURRENCY_DECIMALS, MAX_MINOR, MAX_RATE, currencyPrefix,
  emptyCurrencyTotals, isCurrency, supportsUsdLbpRate,
} from "./currency";
export type { Currency, CurrencyDefinition } from "./currency";

/**
 * Integer minor units: USD cents, LBP whole lira, SYP whole pounds.
 * Callers may sum only amounts denominated in the same currency.
 */
export type Digits = "latin" | "arabic";

export class MoneyRangeError extends RangeError {
  constructor() {
    super("Amount is outside the supported integer money range");
    this.name = "MoneyRangeError";
  }
}

/** Read database integers before any Number conversion can silently round them. */
export function readMinor(value: number | string): number {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new MoneyRangeError();
  if (typeof value === "string" && !/^-?\d+$/.test(value)) throw new MoneyRangeError();
  const minor = BigInt(value);
  if (minor < -BigInt(MAX_MINOR) || minor > BigInt(MAX_MINOR)) throw new MoneyRangeError();
  return Number(minor);
}

/** Exact same-currency accumulation; check the final sum so cancellation works. */
export function sumMinor(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + BigInt(readMinor(value)), BigInt(0));
  if (total < -BigInt(MAX_MINOR) || total > BigInt(MAX_MINOR)) throw new MoneyRangeError();
  return Number(total);
}

function normalizeDigits(input: string): string {
  return normalizeNumericDigits(input)
    .replace(/٫/g, ".")
    .replace(/[٬,\s]/g, "");
}

function resolveDefinition(currency: CurrencyDefinition | Currency): CurrencyDefinition {
  return typeof currency === "string" ? requireCurrency(currency, DEFAULT_CURRENCIES) : currency;
}

/** Parses a user-typed amount ("12.5", "١٢٫٥٠", "1,200") into minor units. Null if invalid. */
export function parseAmount(input: string, definition: CurrencyDefinition): number | null;
/** @deprecated Pass a runtime currency definition. */
export function parseAmount(input: string, currency: Currency): number | null;
export function parseAmount(input: string, currency: CurrencyDefinition | Currency): number | null {
  if (typeof currency === "string" && !isCurrency(currency)) return null;
  const text = normalizeDigits(input.trim());
  const decimals = resolveDefinition(currency).decimalPlaces;
  const pattern = decimals === 0 ? /^\d{1,16}$/ : new RegExp(`^\\d{1,16}(\\.\\d{1,${decimals}})?$`);
  if (!pattern.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const minor = BigInt(whole) * (BigInt(10) ** BigInt(decimals)) + BigInt(fraction.padEnd(decimals, "0") || 0);
  return minor <= BigInt(MAX_MINOR) ? Number(minor) : null;
}

// Only two display digit systems are supported. Reuse Intl's relatively expensive
// locale setup across amounts while preserving the exact integer formatting below.
const numberFormatters: Partial<Record<Digits, Intl.NumberFormat>> = {};

/** Formats minor units for display. Wrap the result in <bdi dir="ltr"> in the UI. */
export function formatAmount(
  minor: number,
  definition: CurrencyDefinition,
  options?: { digits?: Digits; sign?: boolean },
): string;
/** @deprecated Pass a runtime currency definition. */
export function formatAmount(
  minor: number,
  currency: Currency,
  options?: { digits?: Digits; sign?: boolean },
): string;
export function formatAmount(
  minor: number,
  currency: CurrencyDefinition | Currency,
  options: { digits?: Digits; sign?: boolean } = {},
): string {
  const definition = resolveDefinition(currency);
  const prefix = definition.symbol;
  const checked = readMinor(minor);
  const decimals = definition.decimalPlaces;
  const digits = options.digits === "arabic" ? "arabic" : "latin";
  const locale = digits === "arabic" ? "ar-u-nu-arab" : "en-US";
  const absolute = BigInt(Math.abs(checked));
  const scale = BigInt(10) ** BigInt(decimals);
  const formatter = numberFormatters[digits] ??= new Intl.NumberFormat(locale);
  const whole = formatter.format(absolute / scale);
  const fraction = String(absolute % scale).padStart(decimals, "0");
  const localizedFraction = options.digits === "arabic"
    ? fraction.replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)])
    : fraction;
  const body = decimals === 0 ? whole : `${whole}${options.digits === "arabic" ? "٫" : "."}${localizedFraction}`;
  const sign = checked < 0 ? "−" : options.sign && checked > 0 ? "+" : "";
  return `${sign}${prefix}${/[\p{L}\p{N}]/u.test(prefix) ? " " : ""}${body}`;
}

/** Minor units back to the editable text a person would type ("54.2", "400000"). */
export function toInputText(minor: number, definition: CurrencyDefinition): string;
/** @deprecated Pass a runtime currency definition. */
export function toInputText(minor: number, currency: Currency): string;
export function toInputText(minor: number, currency: CurrencyDefinition | Currency): string {
  const decimals = resolveDefinition(currency).decimalPlaces;
  const abs = BigInt(Math.abs(readMinor(minor)));
  if (decimals === 0) return String(abs);
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = String(abs % scale).padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** Display grouping for text being typed: "1234567.5" becomes "1,234,567.5". Latin digits. */
export function groupTyped(typed: string): string {
  const [whole, fraction] = typed.split(".");
  const grouped = (whole || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** Parses a typed rate ("89,500", "٨٩٥٠٠") into whole LBP per dollar, 1..MAX_RATE. Null if invalid. */
export function parseRate(input: string): number | null {
  const text = normalizeDigits(input.trim());
  if (!/^\d{1,8}$/.test(text)) return null;
  const rate = Number(text);
  return rate >= 1 && rate <= MAX_RATE ? rate : null;
}

/**
 * Converts between USD and LBP at a rate of LBP per 1 USD, rounding half up.
 * USD to LBP: cents × rate ÷ 100. LBP to USD: lira × 100 ÷ rate. Integer math
 * only (BigInt), so large lira amounts keep every digit. Null if the result is
 * above MAX_MINOR. USD/LBP identity is allowed; every SYP call returns null.
 */
export function convertAtRate(minor: number, from: Currency, to: Currency, lbpPerUsd: number): number | null {
  if ((from !== "USD" && from !== "LBP") || (to !== "USD" && to !== "LBP")) return null;
  if (!Number.isSafeInteger(minor) || minor < 0 || minor > MAX_MINOR
      || !Number.isSafeInteger(lbpPerUsd) || lbpPerUsd < 1 || lbpPerUsd > MAX_RATE) return null;
  if (from === to) return minor;
  const m = BigInt(minor);
  const r = BigInt(lbpPerUsd);
  const [num, den] = from === "USD" ? [m * r, BigInt(100)] : [m * BigInt(100), r];
  const result = (BigInt(2) * num + den) / (BigInt(2) * den);
  return result <= BigInt(MAX_MINOR) ? Number(result) : null;
}
