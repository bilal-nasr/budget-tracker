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
