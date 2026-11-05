// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CurrencyDefinition } from "@/lib/currency";
import type { WalletContainer } from "@/features/wallets/schema";
import { AppDataProvider, useAppData } from "./app-data";

afterEach(cleanup);

const currencies: CurrencyDefinition[] = [
  { code: "EUR", symbol: "€", decimalPlaces: 2, disabled: false, firstUsed: true },
  { code: "JPY", symbol: "¥", decimalPlaces: 0, disabled: true, firstUsed: false },
];

const wallets: WalletContainer[] = [{
  id: "wallet-pocket",
  name: "Pocket",
  kind: "cash",
  position: 0,
  deleted: false,
  needsAttention: false,
  defaultBalanceId: "balance-eur",
  balances: [
    { id: "balance-eur", walletId: "wallet-pocket", currency: "EUR", openingBalanceMinor: 0, balanceMinor: 1250, position: 0, detached: false },
    { id: "balance-jpy", walletId: "wallet-pocket", currency: "JPY", openingBalanceMinor: 0, balanceMinor: 0, position: 1, detached: false },
  ],
}];

function Probe() {
  const data = useAppData();
  const wallet = data.walletById("wallet-pocket");
  const balance = data.balanceById("balance-jpy");
  const disabled = data.currencyByCode("JPY");
  return <output>{JSON.stringify({
    currencies: data.currencies.map((item) => item.code),
    enabled: data.enabledCurrencies.map((item) => item.code),
    wallet: wallet?.name,
    balance: balance?.currency,
    disabled: disabled?.disabled,
    legacy: data.legacyWalletById("wallet-pocket")?.currency ?? null,
  })}</output>;
}

function provider(children: React.ReactNode, overrides: Partial<React.ComponentProps<typeof AppDataProvider>> = {}) {
  return <AppDataProvider
    walletContainers={wallets}
    currencies={currencies}
    categories={[]}
    timezone="Asia/Beirut"
    salary={null}
    usdLbpRate={null}
    {...overrides}
  >{children}</AppDataProvider>;
}

it("indexes the complete catalog and exact nested balance identities without hiding disabled history", () => {
  render(provider(<Probe />));
  expect(JSON.parse(screen.getByRole("status").textContent ?? "{}")).toEqual({
    currencies: ["EUR", "JPY"],
    enabled: ["EUR"],
    wallet: "Pocket",
    balance: "JPY",
    disabled: true,
    legacy: null,
  });
});

it("does not mutate catalog or wallet inputs while deriving indexes", () => {
  const inputCurrencies = currencies.map((item) => ({ ...item }));
  const inputWallets = wallets.map((wallet) => ({ ...wallet, balances: wallet.balances.map((balance) => ({ ...balance })) }));
  const before = JSON.stringify({ inputCurrencies, inputWallets });
  render(provider(<Probe />, { currencies: inputCurrencies, walletContainers: inputWallets }));
  expect(JSON.stringify({ inputCurrencies, inputWallets })).toBe(before);
});

it("rejects a missing currency definition instead of guessing one", () => {
  expect(() => render(provider(<Probe />, { currencies: currencies.slice(0, 1) }))).toThrow("App currency data unavailable");
});

it("rejects duplicate or cross-wired exact balance identities", () => {
  const duplicate = { ...wallets[0], id: "wallet-other", balances: [{ ...wallets[0].balances[0], walletId: "wallet-other" }] };
  expect(() => render(provider(<Probe />, { walletContainers: [...wallets, duplicate] }))).toThrow("App wallet data unavailable");
  const crossWired = [{ ...wallets[0], balances: [{ ...wallets[0].balances[0], walletId: "wallet-other" }] }];
  expect(() => render(provider(<Probe />, { walletContainers: crossWired }))).toThrow("App wallet data unavailable");
});

it("rejects a default balance owned by a different container", () => {
  const other: WalletContainer = {
    ...wallets[0],
    id: "wallet-other",
    name: "Other",
    defaultBalanceId: "balance-eur",
    balances: [{ ...wallets[0].balances[1], id: "balance-other", walletId: "wallet-other" }],
  };
  expect(() => render(provider(<Probe />, { walletContainers: [...wallets, other] }))).toThrow("App wallet data unavailable");
});

function TombstoneProbe() {
  const data = useAppData();
  return <output>{JSON.stringify({
    canonical: data.walletById("empty-deleted"),
    legacy: data.legacyWalletById("empty-deleted") ?? null,
    legacyCount: data.legacyWallets.length,
  })}</output>;
}

const emptyDeleted: WalletContainer = {
  id: "empty-deleted", name: "Closed", kind: "bank", position: 1,
  deleted: true, needsAttention: false, defaultBalanceId: null, balances: [],
};

it("retains an empty deleted tombstone without inventing a legacy default wallet", () => {
  render(provider(<TombstoneProbe />, { walletContainers: [...wallets, emptyDeleted] }));
  expect(JSON.parse(screen.getByRole("status").textContent ?? "{}")).toEqual({
    canonical: emptyDeleted, legacy: null, legacyCount: 0,
  });
});

it("rejects live or nonempty wallets with null defaults", () => {
  expect(() => render(provider(<TombstoneProbe />, { walletContainers: [{ ...emptyDeleted, deleted: false }] })))
    .toThrow("App wallet data unavailable");
  expect(() => render(provider(<TombstoneProbe />, { walletContainers: [{ ...wallets[0], deleted: true, defaultBalanceId: null }] })))
    .toThrow("App wallet data unavailable");
});

function ViewsProbe() {
  const data = useAppData();
  return <output>{JSON.stringify({
    ordinary: data.walletContainers.map((wallet) => ({ id: wallet.id, currencies: wallet.balances.map((balance) => balance.currency), default: wallet.defaultBalanceId })),
    historical: data.balanceById("balance-jpy"),
    deleted: data.walletById("deleted")?.id,
    attention: data.walletById("attention")?.id,
  })}</output>;
}

it("projects ordinary enabled balances while retaining disabled, deleted, and attention identities", () => {
  const deleted = { ...emptyDeleted, id: "deleted" };
  const attention = { ...wallets[0], id: "attention", needsAttention: true,
    defaultBalanceId: "attention-eur", balances: [{ ...wallets[0].balances[0], id: "attention-eur", walletId: "attention" }] };
  render(provider(<ViewsProbe />, { walletContainers: [...wallets, deleted, attention] }));
  expect(JSON.parse(screen.getByRole("status").textContent ?? "{}")).toEqual({
    ordinary: [{ id: "wallet-pocket", currencies: ["EUR"], default: "balance-eur" }],
    historical: wallets[0].balances[1], deleted: "deleted", attention: "attention",
  });
});

it("updates ordinary coverage and exact history on a complete server refresh without changing defaults", () => {
  const rendered = render(provider(<ViewsProbe />));
  rendered.rerender(provider(<ViewsProbe />, { currencies: currencies.map((currency) => ({ ...currency, disabled: false })) }));
  expect(JSON.parse(screen.getByRole("status").textContent ?? "{}")).toEqual({
    ordinary: [{ id: "wallet-pocket", currencies: ["EUR", "JPY"], default: "balance-eur" }],
    historical: wallets[0].balances[1],
  });
});

it.each(["missing", "duplicate", "detached", "disabledDefault"])("rejects canonical %s enabled coverage", (problem) => {
  const wallet = { ...wallets[0], balances: wallets[0].balances.map((balance) => ({ ...balance })) };
  if (problem === "missing") wallet.balances = wallet.balances.slice(0, 1);
  if (problem === "duplicate") wallet.balances.push({ ...wallet.balances[0], id: "duplicate-currency" });
  if (problem === "detached") wallet.balances[0].detached = true;
  if (problem === "disabledDefault") wallet.defaultBalanceId = "balance-jpy";
  expect(() => render(provider(<Probe />, { walletContainers: [wallet], currencies: problem === "missing" ? currencies.map((currency) => ({ ...currency, disabled: false })) : currencies }))).toThrow("App wallet data unavailable");
});

it("uses catalog order for ordinary balances independently of stored positions", () => {
  const wallet = { ...wallets[0], balances: [...wallets[0].balances].reverse() };
  render(provider(<ViewsProbe />, { walletContainers: [wallet], currencies: currencies.map((currency) => ({ ...currency, disabled: false })) }));
  expect(JSON.parse(screen.getByRole("status").textContent ?? "{}").ordinary[0].currencies).toEqual(["EUR", "JPY"]);
});

it("requires a runtime catalog for canonical wallets rather than inventing built-in definitions", () => {
  const wallet = { ...wallets[0], balances: ["USD", "LBP", "SYP"].map((currency, index) => ({ ...wallets[0].balances[0], currency, id: index === 0 ? "balance-eur" : `built-in-${currency}` })) };
  expect(() => render(provider(<Probe />, { currencies: undefined, walletContainers: [wallet] }))).toThrow("App currency data unavailable");
});

it("keeps default-only compatibility explicitly behind the legacy wallet input", () => {
  render(provider(<Probe />, {
    currencies: undefined, walletContainers: undefined,
    wallets: [{ id: "wallet-pocket", name: "Pocket", kind: "cash", currency: "USD", openingBalanceMinor: 0, balanceMinor: 1250, archived: false, position: 0 }],
  }));
  expect(JSON.parse(screen.getByRole("status").textContent ?? "{}").legacy).toBe("USD");
});

it("exposes enabled Needs-attention balances separately from ordinary and deleted wallets", () => {
  function AttentionProbe() {
    const data = useAppData();
    return <output>{JSON.stringify({ ordinary: data.walletContainers.map((wallet) => wallet.id), attention: data.needsAttentionWallets.map((wallet) => ({ id: wallet.id, currencies: wallet.balances.map((balance) => balance.currency) })) })}</output>;
  }
  render(provider(<AttentionProbe />, { walletContainers: [{ ...wallets[0], needsAttention: true }] }));
  expect(JSON.parse(screen.getByRole("status").textContent!)).toEqual({ ordinary: [], attention: [{ id: "wallet-pocket", currencies: ["EUR"] }] });
});
