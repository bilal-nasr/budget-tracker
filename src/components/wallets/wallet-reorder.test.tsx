// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { AppDataProvider, useAppData } from "@/components/providers/app-data";
import type { WalletContainer } from "@/features/wallets/schema";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { WalletReorder } from "./wallet-reorder";

const mocks = vi.hoisted(() => ({ reorderWallets: vi.fn() }));
vi.mock("@/features/wallets/actions", () => mocks);

const wallets: WalletContainer[] = ["Pocket", "Bank", "Card", "Review", "Deleted"].map((name, position) => ({
  id: name, name, kind: "cash", position, deleted: name === "Deleted", needsAttention: name === "Review", defaultBalanceId: `${name}-USD`,
  balances: ["USD", "SYP"].map((currency, position) => ({ id: `${name}-${currency}`, walletId: name, currency, position, openingBalanceMinor: 0, balanceMinor: 0, detached: false })),
}));
const currencies = [{ code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true }, { code: "SYP", symbol: "SYP", decimalPlaces: 0, disabled: false, firstUsed: true }];
function SelectorProbe() {
  const data = useAppData();
  return <select aria-label="Shared wallet selector">{data.walletContainers.map((wallet) => <option key={wallet.id}>{wallet.name}</option>)}</select>;
}
function view(locale = "en", input = wallets) {
  return <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : ar}><AppDataProvider walletContainers={input} currencies={currencies} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}>
    <WalletReorder>{(wallet) => <button>{wallet.name}</button>}</WalletReorder><SelectorProbe />
  </AppDataProvider></NextIntlClientProvider>;
}
function names() { return screen.getAllByRole("listitem").map((item) => item.textContent); }
function move(name = "Pocket", end = " ") {
  const handle = screen.getByRole("button", { name: `Reorder ${name}` });
  handle.focus();
  fireEvent.keyDown(handle, { key: " " });
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  fireEvent.keyDown(handle, { key: end });
  return handle;
}
beforeEach(() => { mocks.reorderWallets.mockReset().mockResolvedValue({ ok: true }); });
afterEach(cleanup);

it("saves the complete ordinary active order and shares keyboard preview with selectors", async () => {
  render(view());
  const handle = move();
  await waitFor(() => expect(mocks.reorderWallets).toHaveBeenCalledExactlyOnceWith(["Bank", "Pocket", "Card"]));
  expect(names()).toEqual(["Bank", "Pocket", "Card"]);
  expect(within(screen.getByRole("combobox")).getAllByRole("option").map((item) => item.textContent)).toEqual(["Bank", "Pocket", "Card"]);
  expect(document.activeElement).toBe(handle);
  expect(screen.queryByRole("button", { name: "Reorder Review" })).toBeNull();
});
it("Escape restores the previous order without a write and retains handle focus", () => {
  render(view());
  const handle = move("Pocket", "Escape");
  expect(names()).toEqual(["Pocket", "Bank", "Card"]);
  expect(mocks.reorderWallets).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(handle);
  expect(screen.getByText("Cancelled reordering Pocket.", { selector: "p" })).toBeTruthy();
});
it.each(["result", "throw"])("restores the previous provider-wide order on %s failure and allows retry", async (failure) => {
  if (failure === "throw") mocks.reorderWallets.mockRejectedValueOnce(new Error("private detail"));
  else mocks.reorderWallets.mockResolvedValueOnce({ ok: false, error: "reorderConflict" });
  render(view());
  move();
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(names()).toEqual(["Pocket", "Bank", "Card"]);
  expect(within(screen.getByRole("combobox")).getAllByRole("option").map((item) => item.textContent)).toEqual(["Pocket", "Bank", "Card"]);
  await waitFor(() => expect(screen.getByRole("button", { name: "Reorder Pocket" }).getAttribute("aria-disabled")).toBe("false"));
  move();
  await waitFor(() => expect(names()).toEqual(["Bank", "Pocket", "Card"]));
  expect(screen.queryByRole("alert")).toBeNull();
});
it("blocks concurrent reorder writes until the pending save completes", async () => {
  let finish!: (result: { ok: true }) => void;
  mocks.reorderWallets.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(view());
  move();
  await waitFor(() => expect(screen.getByRole("button", { name: "Reorder Bank" }).getAttribute("aria-disabled")).toBe("true"));
  move("Bank");
  expect(mocks.reorderWallets).toHaveBeenCalledTimes(1);
  await act(async () => finish({ ok: true }));
});
it("Enter picks up/drops; boundary arrows and unchanged drops do not write", () => {
  render(view());
  const handle = screen.getByRole("button", { name: "Reorder Pocket" });
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  fireEvent.keyDown(handle, { key: "Enter" });
  fireEvent.keyDown(handle, { key: "ArrowUp" });
  fireEvent.keyDown(handle, { key: "Enter" });
  expect(names()).toEqual(["Pocket", "Bank", "Card"]);
  expect(mocks.reorderWallets).not.toHaveBeenCalled();
});
it("uses Arabic instructions, labels and announcements", () => {
  render(view("ar"));
  const label = ar.Wallets.reorderNamed.replace("{name}", "Pocket");
  const handle = screen.getByRole("button", { name: label });
  expect(document.getElementById(handle.getAttribute("aria-describedby")!)?.textContent).toBe(ar.Wallets.sortHelp);
  fireEvent.keyDown(handle, { key: " " });
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  expect(screen.getByText("تم نقل Pocket إلى الموضع 2 من 3.", { selector: "p" })).toBeTruthy();
  fireEvent.keyDown(handle, { key: "Escape" });
});
it("accepts authoritative refreshed order, including append and delete compaction", async () => {
  const rendered = render(view());
  move();
  await waitFor(() => expect(mocks.reorderWallets).toHaveBeenCalledTimes(1));
  const refreshed = [wallets[2], wallets[1]].map((wallet, position) => ({ ...wallet, position }));
  const appended = { ...wallets[0], position: 2 };
  rendered.rerender(view("en", [appended, ...refreshed]));
  expect(names()).toEqual(["Card", "Bank", "Pocket"]);
});
it("releases keyboard pickup when a refreshed list removes the picked wallet", async () => {
  const rendered = render(view());
  const handle = screen.getByRole("button", { name: "Reorder Pocket" });
  fireEvent.keyDown(handle, { key: " " });
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  rendered.rerender(view("en", wallets.slice(1, 3).map((wallet, position) => ({ ...wallet, position }))));
  expect(screen.getByRole("button", { name: "Reorder Bank" }).getAttribute("aria-disabled")).toBe("false");
  move("Bank");
  await waitFor(() => expect(mocks.reorderWallets).toHaveBeenCalledExactlyOnceWith(["Card", "Bank"]));
});

const refreshCases = [
  { change: "append", input: [...wallets.slice(0, 3), { ...wallets[3], needsAttention: false }], expected: ["Pocket", "Bank", "Card", "Review"] },
  { change: "remove another wallet", input: [wallets[0], { ...wallets[2], position: 1 }], expected: ["Pocket", "Card"] },
  { change: "authoritative reorder", input: [{ ...wallets[2], position: 0 }, { ...wallets[0], position: 1 }, { ...wallets[1], position: 2 }], expected: ["Card", "Pocket", "Bank"] },
];
it.each(refreshCases)("invalidates surviving keyboard pickup after $change so Escape retains canonical order", ({ input, expected }) => {
  const rendered = render(view());
  const handle = screen.getByRole("button", { name: "Reorder Pocket" });
  fireEvent.keyDown(handle, { key: " " });
  rendered.rerender(view("en", input));
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  fireEvent.keyDown(handle, { key: "Escape" });
  expect(names()).toEqual(expected);
  expect(within(screen.getByRole("combobox")).getAllByRole("option").map((item) => item.textContent)).toEqual(expected);
  expect(handle.getAttribute("aria-pressed")).toBe("false");
  expect(mocks.reorderWallets).not.toHaveBeenCalled();
});
it.each(refreshCases)("uses the refreshed $change order for a subsequent failed-save rollback", async ({ input, expected }) => {
  mocks.reorderWallets.mockResolvedValueOnce({ ok: false, error: "reorderConflict" });
  const rendered = render(view());
  const handle = screen.getByRole("button", { name: "Reorder Pocket" });
  fireEvent.keyDown(handle, { key: " " });
  rendered.rerender(view("en", input));
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  fireEvent.keyDown(handle, { key: "Escape" });
  move();
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(names()).toEqual(expected);
  expect(within(screen.getByRole("combobox")).getAllByRole("option").map((item) => item.textContent)).toEqual(expected);
  expect(mocks.reorderWallets).toHaveBeenCalledTimes(1);
});
