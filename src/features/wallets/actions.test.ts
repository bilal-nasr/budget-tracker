import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actionClient: vi.fn(), revalidatePath: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/action", async (original) => {
  const actual = await original<typeof import("@/lib/supabase/action")>();
  return { ...actual, actionClient: mocks.actionClient };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  addWalletBalance,
  createWallet,
  detachWalletBalance,
  setDefaultWalletBalance,
  updateWallet,
} from "./actions";

const owner = "aaaaaaaa-0000-4000-8000-000000000001";
const walletId = "aaaaaaaa-0000-4000-8000-000000000002";
const balanceId = "aaaaaaaa-0000-4000-8000-000000000003";
let writeResult: { data: unknown; error: null | { code?: string; message?: string } };

function writeQuery() {
  const query: Record<string, unknown> = {};
  for (const method of ["update", "eq", "select"]) query[method] = vi.fn().mockReturnValue(query);
  query.maybeSingle = vi.fn(() => Promise.resolve(writeResult));
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  writeResult = { data: { id: walletId }, error: null };
  mocks.from.mockReturnValue(writeQuery());
  mocks.rpc.mockResolvedValue({ data: balanceId, error: null });
  mocks.actionClient.mockResolvedValue({ userId: owner, supabase: { rpc: mocks.rpc, from: mocks.from } });
});

describe("wallet balance actions", () => {
  it("creates a fully covered container with a chosen default through one RPC", async () => {
    const result = await createWallet({ name: " Pocket ", kind: "cash", currency: " eur ", openingBalanceMinor: 125 });
    expect(result).toEqual({ ok: true, id: balanceId });
    expect(mocks.rpc).toHaveBeenCalledWith("create_wallet", {
      p_name: "Pocket", p_kind: "cash", p_default_currency: "EUR", p_opening_minor: 125,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });

  it("updates only container metadata and owner-scopes the row", async () => {
    await expect(updateWallet(walletId, { name: " Daily ", kind: "card" })).resolves.toEqual({ ok: true });
    const query = mocks.from.mock.results[0].value;
    expect(mocks.from).toHaveBeenCalledWith("wallets");
    expect(query.update).toHaveBeenCalledWith({ name: "Daily", kind: "card" });
    expect(query.eq).toHaveBeenCalledWith("id", walletId);
    expect(query.eq).toHaveBeenCalledWith("user_id", owner);
  });

  it("adds or restores a currency at zero without accepting an opening amount", async () => {
    await expect(addWalletBalance(walletId, { currency: " eur " })).resolves.toEqual({ ok: true, id: balanceId });
    expect(mocks.rpc).toHaveBeenCalledWith("add_wallet_balance", { p_wallet_id: walletId, p_currency: "EUR" });
    expect(await addWalletBalance(walletId, { currency: "EUR", openingBalanceMinor: 1 } as never))
      .toEqual({ ok: false, error: "invalid" });
  });

  it("sets and detaches exact balance IDs", async () => {
    await expect(setDefaultWalletBalance(walletId, balanceId)).resolves.toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith("set_wallet_default", { p_wallet_id: walletId, p_balance_id: balanceId });
    await expect(detachWalletBalance(balanceId)).resolves.toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith("detach_wallet_balance", { p_balance_id: balanceId });
  });

  it.each([
    ["currency.disabled", "currencyDisabled"],
    ["wallet.unavailable", "walletUnavailable"],
    ["wallet.invalidDefault", "invalidDefault"],
    ["wallet.deleted", "walletDeleted"],
    ["wallet.needsAttention", "walletNeedsAttention"],
    ["balance.unavailable", "balanceUnavailable"],
    ["balance.nonzero", "balanceNonzero"],
    ["balance.inUse", "balanceInUse"],
    ["private database detail", "failed"],
  ] as const)("maps %s without exposing private details", async (message, error) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } });
    expect(await detachWalletBalance(balanceId)).toEqual({ ok: false, error });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects forged inputs and preserves authentication failures without writes", async () => {
    expect(await createWallet({ name: "Pocket", kind: "cash", currency: "bad code", openingBalanceMinor: 0 })).toEqual({ ok: false, error: "invalid" });
    expect(await setDefaultWalletBalance(walletId, "bad")).toEqual({ ok: false, error: "invalid" });
    expect(mocks.actionClient).not.toHaveBeenCalled();
    mocks.actionClient.mockResolvedValue({ error: "notConfigured" });
    expect(await detachWalletBalance(balanceId)).toEqual({ ok: false, error: "notConfigured" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("contains an unexpected session transport failure", async () => {
    mocks.actionClient.mockRejectedValue(new Error("private session detail"));
    await expect(detachWalletBalance(balanceId)).resolves.toEqual({ ok: false, error: "failed" });
  });
});
