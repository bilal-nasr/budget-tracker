import { describe, expect, it } from "vitest";
import { MAX_MINOR } from "@/lib/money";
import { DEFAULT_CURRENCIES, type CurrencyDefinition } from "@/lib/currency";
import {
  attachedBalances, defaultBalance, nextDefaultBalance, totalsByCurrency,
  walletContainerSchema, walletInputSchema, type Wallet, type WalletContainer,
} from "./schema";

const currencies = DEFAULT_CURRENCIES.filter((definition) => definition.code !== "SYP");
const pocket: WalletContainer = {
  id: "pocket", name: "Pocket", kind: "cash", position: 0, deleted: false, needsAttention: false,
  defaultBalanceId: "usd-balance",
  balances: [
    { id: "lbp-balance", walletId: "pocket", currency: "LBP", openingBalanceMinor: 0,
      balanceMinor: 4_250_000, position: 1, detached: false },
    { id: "usd-balance", walletId: "pocket", currency: "USD", openingBalanceMinor: 0,
      balanceMinor: 1250, position: 0, detached: false },
  ],
};

describe("wallet balance domain", () => {
  it("selects an enabled attached default", () => {
    expect(defaultBalance(pocket, currencies).id).toBe("usd-balance");
    expect(attachedBalances(pocket, currencies).map((balance) => balance.id))
      .toEqual(["usd-balance", "lbp-balance"]);
    const lbpDefault = { ...pocket, defaultBalanceId: "lbp-balance" };
    expect(attachedBalances(lbpDefault, currencies).map((balance) => balance.id))
      .toEqual(["lbp-balance", "usd-balance"]);
    expect(attachedBalances(pocket, currencies.map((definition) => ({ ...definition, disabled: definition.code === "LBP" }))))
      .toHaveLength(1);
    expect(attachedBalances({ ...pocket, balances: pocket.balances.map((balance) => ({ ...balance, detached: balance.currency === "LBP" })) }, currencies))
      .toHaveLength(1);
  });

  it("chooses the next default cyclically", () => {
    expect(nextDefaultBalance(pocket, "USD", currencies)?.id).toBe("lbp-balance");
    expect(nextDefaultBalance({ ...pocket, defaultBalanceId: "lbp-balance" }, "LBP", currencies)?.id)
      .toBe("usd-balance");
    const eur: CurrencyDefinition = { code: "EUR", symbol: "€", decimalPlaces: 2, disabled: false, firstUsed: false };
    const multiple = { ...pocket, balances: [
      ...pocket.balances,
      { ...pocket.balances[0], id: "eur-balance", currency: "EUR", position: 2 },
    ] };
    expect(nextDefaultBalance(multiple, "USD", [eur, ...currencies.map((definition) => ({ ...definition, disabled: definition.code === "LBP" }))])?.id)
      .toBe("eur-balance");
    expect(nextDefaultBalance({ ...pocket, balances: [pocket.balances[1]] }, "USD", currencies)).toBeNull();
  });

  it("totals balance rows by runtime currency", () => {
    expect(totalsByCurrency([pocket], currencies)).toEqual({ USD: 1250, LBP: 4_250_000 });
    expect(totalsByCurrency([{ ...pocket, deleted: true }], currencies)).toEqual({ USD: 0, LBP: 0 });
    expect(totalsByCurrency([{ ...pocket, needsAttention: true }], currencies)).toEqual({ USD: 1250, LBP: 4_250_000 });
    expect(totalsByCurrency([{ ...pocket, balances: pocket.balances.map((balance) => ({ ...balance, detached: true })) }],
      currencies.map((definition) => ({ ...definition, disabled: true }))))
      .toEqual({ USD: 1250, LBP: 4_250_000 });
    const debt = { ...pocket, balances: [{ ...pocket.balances[1], balanceMinor: -250 }] };
    expect(totalsByCurrency([pocket, debt], currencies)).toEqual({ USD: 1000, LBP: 4_250_000 });
    const maximum = { ...pocket, balances: [{ ...pocket.balances[1], balanceMinor: MAX_MINOR }] };
    expect(totalsByCurrency([maximum, maximum, { ...maximum, balances: [{ ...maximum.balances[0], balanceMinor: -MAX_MINOR }] }], currencies))
      .toEqual({ USD: MAX_MINOR, LBP: 0 });
    expect(() => totalsByCurrency([maximum, pocket], currencies)).toThrow();
  });

  it("fails visibly for missing definitions and invalid defaults", () => {
    expect(() => defaultBalance(pocket, [])).toThrow();
    expect(() => attachedBalances(pocket, [])).toThrow();
    expect(() => totalsByCurrency([pocket], [])).toThrow();
    expect(() => nextDefaultBalance(pocket, "USD", [])).toThrow();
    expect(() => defaultBalance({ ...pocket, defaultBalanceId: "other-wallet-balance" }, currencies)).toThrow();
    expect(() => defaultBalance({ ...pocket, balances: pocket.balances.map((balance) => ({ ...balance, detached: balance.currency === "USD" })) }, currencies)).toThrow();
    expect(() => defaultBalance(pocket, currencies.map((definition) => ({ ...definition, disabled: definition.code === "USD" })))).toThrow();
  });

  it("rejects duplicate currencies and cross-wallet balance/default references", () => {
    expect(walletContainerSchema.safeParse(pocket).success).toBe(true);
    expect(walletContainerSchema.safeParse({ ...pocket, balances: [...pocket.balances, { ...pocket.balances[0], id: "duplicate" }] }).success).toBe(false);
    expect(walletContainerSchema.safeParse({ ...pocket, defaultBalanceId: "foreign" }).success).toBe(false);
    expect(walletContainerSchema.safeParse({ ...pocket, balances: pocket.balances.map((balance) => ({ ...balance, walletId: "foreign" })) }).success).toBe(false);
    expect(walletContainerSchema.safeParse({ ...pocket, balances: pocket.balances.map((balance) => ({ ...balance, detached: true })) }).success).toBe(false);
    expect(walletContainerSchema.safeParse({ ...pocket, balances: [{ ...pocket.balances[1], balanceMinor: 0.5 }] }).success).toBe(false);
    expect(() => defaultBalance({ ...pocket, balances: [...pocket.balances, pocket.balances[0]] }, currencies)).toThrow();
  });
});

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
