import { z } from "zod";
import type { CurrencyDefinition } from "./currency";

/** Only denominations actually used by this draft, never the whole catalog. */
export const expectedUnitsSchema = z.record(z.string().regex(/^[A-Z][A-Z0-9]{0,11}$/), z.number().int().min(0).max(8))
  .refine((units) => Object.keys(units).length > 0 && Object.keys(units).length <= 64);
export type ExpectedUnits = z.infer<typeof expectedUnitsSchema>;

/** Capture the definitions that parsed the draft; absence stays absent. */
export function currencyIntent(...definitions: readonly (CurrencyDefinition | undefined)[]): ExpectedUnits | undefined {
  if (!definitions.length || definitions.some((definition) => !definition)) return undefined;
  const units: ExpectedUnits = {};
  for (const definition of definitions) {
    if (!definition) return undefined;
    if (units[definition.code] !== undefined && units[definition.code] !== definition.decimalPlaces) throw new Error("Conflicting draft units");
    units[definition.code] = definition.decimalPlaces;
  }
  return expectedUnitsSchema.parse(units);
}

/** Unit metadata travels in the same database request, outside legacy RPC bodies. */
export function withoutCurrencyIntent<T extends { expectedUnits?: ExpectedUnits }>(input: T): Omit<T, "expectedUnits"> {
  const body = { ...input };
  delete body.expectedUnits;
  return body;
}
