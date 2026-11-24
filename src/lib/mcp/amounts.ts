import { moneyOut } from "./tool";
import type { CurrencyDefinition } from "@/lib/money";

export type MoneyOut = ReturnType<typeof moneyOut>;
/** An amount whose currency is not in the person's list: raw fields only, no formatted text. */
export type RawMoney = { minor: number; currency: string };

/**
 * Builds `amount(minor, code)` over the person's currency list. Unknown codes (for example a
 * deleted currency) give `{ minor, currency }` without `text` instead of throwing.
 */
export function amountFormatter(currencies: readonly CurrencyDefinition[]): (minor: number, code: string) => MoneyOut | RawMoney {
  const byCode = new Map(currencies.map((currency) => [currency.code, currency]));
  return (minor, code) => {
    const definition = byCode.get(code);
    return definition ? moneyOut(minor, definition) : { minor, currency: code };
  };
}
