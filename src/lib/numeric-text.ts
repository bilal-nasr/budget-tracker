/** Normalize keyboard digit scripts for parsing, never for a live input value. */
export function normalizeNumericDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/** Optional calendar day; invalid drafts stay visible instead of being filtered. */
export function parseOptionalDay(input: string): { value: number | null; invalid: boolean } {
  const text = normalizeNumericDigits(input.trim());
  if (text === "") return { value: null, invalid: false };
  if (!/^\d{1,2}$/.test(text)) return { value: null, invalid: true };
  const value = Number(text);
  return value >= 1 && value <= 31
    ? { value, invalid: false }
    : { value: null, invalid: true };
}
