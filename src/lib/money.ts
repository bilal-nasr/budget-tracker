/**
 * Exact money handling. Amounts are integer minor units: USD cents, LBP whole
 * lira. This module never adds two currencies.
 */
export type Currency = "USD" | "LBP";
export type Digits = "latin" | "arabic";

export const CURRENCY_DECIMALS: Readonly<Record<Currency, 0 | 2>> = {
  USD: 2,
  LBP: 0,
};
export const MAX_MINOR = 1_000_000_000_000_000; // 1e15, < 2^53

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/[٬,\s]/g, "");
}

/** Parses a user-typed amount ("12.5", "١٢٫٥٠", "1,200") into minor units. Null if invalid. */
export function parseAmount(input: string, currency: Currency): number | null {
  const text = normalizeDigits(input.trim());
  const decimals = CURRENCY_DECIMALS[currency];
  const pattern = decimals === 0 ? /^\d{1,16}$/ : /^\d{1,16}(\.\d{1,2})?$/;
  if (!pattern.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const minor =
    Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, "0") || 0);
  return Number.isSafeInteger(minor) && minor <= MAX_MINOR ? minor : null;
}

/** Formats minor units for display. Wrap the result in <bdi dir="ltr"> in the UI. */
export function formatAmount(
  minor: number,
  currency: Currency,
  options: { digits?: Digits; sign?: boolean } = {},
): string {
  const decimals = CURRENCY_DECIMALS[currency];
  const locale = options.digits === "arabic" ? "ar-u-nu-arab" : "en-US";
  const value = Math.abs(minor) / 10 ** decimals;
  const body = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
  const sign = minor < 0 ? "−" : options.sign && minor > 0 ? "+" : "";
  return currency === "USD" ? `${sign}$${body}` : `${sign}LBP ${body}`;
}

/** Minor units back to the editable text a person would type ("54.2", "400000"). */
export function toInputText(minor: number, currency: Currency): string {
  const decimals = CURRENCY_DECIMALS[currency];
  const abs = Math.abs(minor);
  if (decimals === 0) return String(abs);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** Display grouping for text being typed: "1234567.5" becomes "1,234,567.5". Latin digits. */
export function groupTyped(typed: string): string {
  const [whole, fraction] = typed.split(".");
  const grouped = (whole || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

export const MAX_RATE = 10_000_000; // LBP per 1 USD

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
 * above MAX_MINOR. The same currency comes back unchanged.
 */
export function convertAtRate(minor: number, from: Currency, to: Currency, lbpPerUsd: number): number | null {
  if (from === to) return minor;
  const m = BigInt(minor);
  const r = BigInt(lbpPerUsd);
  const [num, den] = from === "USD" ? [m * r, BigInt(100)] : [m * BigInt(100), r];
  const result = (BigInt(2) * num + den) / (BigInt(2) * den);
  return result <= BigInt(MAX_MINOR) ? Number(result) : null;
}
