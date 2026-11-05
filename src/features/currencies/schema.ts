import { z } from "zod";

export const currencyCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{0,11}$/);

export const currencyInputSchema = z.object({
  code: currencyCodeSchema,
  symbol: z.string().trim().refine((symbol) => {
    const length = Array.from(symbol).length;
    return length >= 1 && length <= 12;
  }, "Symbol must contain 1–12 Unicode code points"),
  decimalPlaces: z.number().int().min(0).max(8),
});

export type CurrencyInput = z.infer<typeof currencyInputSchema>;
export type { CurrencyDefinition } from "@/lib/currency";
