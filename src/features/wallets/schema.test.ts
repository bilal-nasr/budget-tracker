import { describe, expect, it } from "vitest";
import { MAX_MINOR } from "@/lib/money";
import { totalsByCurrency, walletInputSchema, type Wallet } from "./schema";

const wallet = (currency: Wallet["currency"], balanceMinor: number, archived = false): Wallet => ({
  id: currency, name: currency, kind: "cash", currency, balanceMinor, openingBalanceMinor: 0, position: 0, archived,
});

describe("wallet currency schema and totals", () => {
  it("accepts signed SYP whole pounds but rejects unknown currencies and fractional minor units", () => {
    const input = { name: "Synthetic SYP", kind: "cash", currency: "SYP", openingBalanceMinor: -1250 };
    expect(walletInputSchema.safeParse(input).success).toBe(true);
    expect(walletInputSchema.safeParse({ ...input, currency: "EUR" }).success).toBe(false);
    expect(walletInputSchema.safeParse({ ...input, openingBalanceMinor: 12.5 }).success).toBe(false);
    expect(walletInputSchema.safeParse({ ...input, openingBalanceMinor: MAX_MINOR + 1 }).success).toBe(false);
  });
  it("keeps all three currencies separate, including debt, zero and archived wallets", () => {
    expect(totalsByCurrency([
      wallet("USD", 200), wallet("LBP", 900000), wallet("SYP", 1250),
      wallet("SYP", -250), wallet("SYP", 99999, true),
    ])).toEqual({ USD: 200, LBP: 900000, SYP: 1000 });
    expect(totalsByCurrency([])).toEqual({ USD: 0, LBP: 0, SYP: 0 });
  });
  it("keeps exact cancellation when summing signed wallet balances", () => {
    expect(totalsByCurrency([wallet("SYP", MAX_MINOR), wallet("SYP", MAX_MINOR), wallet("SYP", -MAX_MINOR)]).SYP)
      .toBe(MAX_MINOR);
  });
});
