import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actionClient: vi.fn(), revalidatePath: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/action", async (original) => {
  const actual = await original<typeof import("@/lib/supabase/action")>();
  return { ...actual, actionClient: mocks.actionClient };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  createWallet,
  setDefaultWalletBalance,
  updateWallet,
  reorderWallets,
} from "./actions";

import * as walletActions from "./actions";

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
  it("saves the complete global wallet permutation through the atomic RPC", async () => {
    expect(await reorderWallets([balanceId, walletId])).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("reorder_wallets", { p_ids: [balanceId, walletId] });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });
  it.each([{ ids: [walletId, walletId] }, { ids: ["bad"] }, { ids: [null] }, { ids: "not-an-array" }])("rejects malformed order $ids before authentication", async ({ ids }) => {
    expect(await reorderWallets(ids as unknown as string[])).toEqual({ ok: false, error: "invalid" });
    expect(mocks.actionClient).not.toHaveBeenCalled();
  });
  it.each([["wallet.reorderConflict", "reorderConflict"], ["private detail", "failed"]])("contains an incomplete, stale, or foreign order RPC failure %s", async (message, error) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    expect(await reorderWallets([walletId])).toEqual({ ok: false, error });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it("contains reorder authentication and transport failures", async () => {
    mocks.actionClient.mockResolvedValueOnce({ error: "notConfigured" });
    expect(await reorderWallets([walletId])).toEqual({ ok: false, error: "notConfigured" });
    mocks.rpc.mockRejectedValueOnce(new Error("private transport"));
    expect(await reorderWallets([walletId])).toEqual({ ok: false, error: "failed" });
    mocks.actionClient.mockRejectedValueOnce(new Error("private auth"));
    expect(await reorderWallets([walletId])).toEqual({ ok: false, error: "failed" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
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

  it("does not expose per-wallet currency attachment or detachment", () => {
    expect(walletActions).not.toHaveProperty("addWalletBalance");
    expect(walletActions).not.toHaveProperty("detachWalletBalance");
  });

  it("sets the exact default balance ID", async () => {
    await expect(setDefaultWalletBalance(walletId, balanceId)).resolves.toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("set_wallet_default", { p_wallet_id: walletId, p_balance_id: balanceId });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout");
  });

  it("defaults an omitted opening amount to zero", async () => {
    expect(await createWallet({ name: "Pocket", kind: "cash", currency: "EUR" })).toEqual({ ok: true, id: balanceId });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("create_wallet", {
      p_name: "Pocket", p_kind: "cash", p_default_currency: "EUR", p_opening_minor: 0,
    });
  });

  it.each([null, {}, "", "not-a-uuid"])("rejects a malformed wallet RPC result %o", async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect(await createWallet({ name: "Pocket", kind: "cash", currency: "EUR", openingBalanceMinor: -125 }))
      .toEqual({ ok: false, error: "failed" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
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
    expect(await setDefaultWalletBalance(walletId, balanceId)).toEqual({ ok: false, error });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("accepts a signed opening and contains create failures without revalidation", async () => {
    const input = { name: "Card", kind: "card" as const, currency: "EUR", openingBalanceMinor: -125 };
    expect(await createWallet(input)).toEqual({ ok: true, id: balanceId });
    expect(mocks.rpc).toHaveBeenCalledWith("create_wallet", { p_name: "Card", p_kind: "card", p_default_currency: "EUR", p_opening_minor: -125 });
    mocks.revalidatePath.mockClear();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "currency.disabled" } });
    expect(await createWallet(input)).toEqual({ ok: false, error: "currencyDisabled" });
    mocks.rpc.mockRejectedValueOnce(new Error("private transport"));
    expect(await createWallet(input)).toEqual({ ok: false, error: "failed" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects forged inputs and preserves authentication failures without writes", async () => {
    expect(await createWallet({ name: "Pocket", kind: "cash", currency: "bad code", openingBalanceMinor: 0 })).toEqual({ ok: false, error: "invalid" });
    expect(await setDefaultWalletBalance(walletId, "bad")).toEqual({ ok: false, error: "invalid" });
    expect(mocks.actionClient).not.toHaveBeenCalled();
    mocks.actionClient.mockResolvedValue({ error: "notConfigured" });
    expect(await setDefaultWalletBalance(walletId, balanceId)).toEqual({ ok: false, error: "notConfigured" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("contains an unexpected session transport failure", async () => {
    mocks.actionClient.mockRejectedValue(new Error("private session detail"));
    await expect(setDefaultWalletBalance(walletId, balanceId)).resolves.toEqual({ ok: false, error: "failed" });
  });
});
