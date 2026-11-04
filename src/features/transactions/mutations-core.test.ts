import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ actionClient: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/action", () => ({ actionClient: mock.actionClient }));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidatePath }));
import {
  createTransactionCore, deleteTransactionCore, restoreTransactionCore,
  transactionMutationError, updateTransactionCore,
} from "./mutations-core";
import { transactionWriteInputSchema, type TransactionWriteInput } from "./mutation-input";

const id = "aaaaaaaa-0000-4000-8000-000000000001";
const walletId = "aaaaaaaa-0000-4000-8000-000000000002";
const categoryId = "aaaaaaaa-0000-4000-8000-000000000003";
const input: TransactionWriteInput = {
  kind: "expense", occurredOn: "2026-11-04", walletId, categoryId,
  amountMinor: 5000, note: "  Sister  ", items: [{ description: " Phone credits ", amountMinor: 2000 }],
};
const parentInput = {
  kind: "expense", occurredOn: "2026-11-04", walletId, categoryId, amountMinor: 5000, note: "Sister",
};
const mutation = { id, revision: 8 };

beforeEach(() => {
  vi.clearAllMocks();
  mock.actionClient.mockResolvedValue({ userId: id, supabase: { rpc: mock.rpc } });
  mock.rpc.mockResolvedValue({ data: [mutation], error: null });
});

describe("canonical transaction input", () => {
  it("retains optional preserve/clear semantics and trims descriptions/names", () => {
    expect(transactionWriteInputSchema.parse(input)).toMatchObject({ note: "Sister", items: [{ description: "Phone credits" }] });
    expect(transactionWriteInputSchema.parse({ ...input, items: undefined, settlement: null }).settlement).toBeNull();
  });

  it("rejects impossible dates, hierarchy/ownership fields, non-expense items and excess sums", () => {
    for (const value of [
      { ...input, occurredOn: "2026-02-31" }, { ...input, occurredOn: "1999-12-31" },
      { ...input, ownerId: id }, { ...input, kind: "income" },
      { ...input, items: [{ description: "x", amountMinor: 5001 }] },
      { ...input, items: [{ description: "x", amountMinor: 1, currency: "USD" }] },
      { ...input, settlement: { tenderMinor: 6000, change: null, source: "forged" } },
      { ...input, kind: "income", items: [], settlement: { tenderMinor: 5000, change: null } },
    ]) expect(transactionWriteInputSchema.safeParse(value).success).toBe(false);
  });
});

describe("create/update transaction core", () => {
  it("uses the same supplied UUID and null revision for repeated creates, one RPC per call", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await createTransactionCore(input, id)).toEqual({ ok: true, ...mutation });
    }
    expect(mock.rpc).toHaveBeenCalledTimes(2);
    for (const [name, args] of mock.rpc.mock.calls) {
      expect(name).toBe("save_transaction");
      expect(args).toEqual({
        p_id: id, p_expected_revision: null, p_input: parentInput,
        p_items: [{ description: "Phone credits", amountMinor: 2000 }], p_settlement: null,
      });
    }
    expect(mock.revalidatePath).toHaveBeenCalledTimes(2);
    expect(mock.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("normalizes UUID case but never generates a new draft identity", async () => {
    expect(await createTransactionCore(input, id.toUpperCase())).toEqual({ ok: true, ...mutation });
    expect(mock.rpc.mock.calls[0][1].p_id).toBe(id);
  });

  it("passes exact update revision and distinguishes preserve from explicit clears", async () => {
    expect(await updateTransactionCore(id, { ...input, items: undefined }, 4)).toEqual({ ok: true, ...mutation });
    expect(mock.rpc).toHaveBeenLastCalledWith("save_transaction", {
      p_id: id, p_expected_revision: 4, p_input: parentInput, p_items: null, p_settlement: null,
    });
    expect(await updateTransactionCore(id, { ...input, items: [], settlement: null }, 5)).toEqual({ ok: true, ...mutation });
    expect(mock.rpc.mock.calls[1][1]).toMatchObject({ p_expected_revision: 5, p_items: [], p_settlement: {} });
  });

  it("forwards the exact validated settlement snapshot in the same aggregate RPC", async () => {
    const settlement = { tenderMinor: 6000, change: { walletId, amountMinor: 1000 } };
    await createTransactionCore({ ...input, settlement }, id);
    expect(mock.rpc.mock.calls[0][1].p_settlement).toEqual(settlement);
    expect(mock.rpc.mock.calls[0][1].p_input).not.toHaveProperty("settlement");
    expect(mock.rpc.mock.calls[0][1].p_input).not.toHaveProperty("items");
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid input/IDs/revisions before auth or database access", async () => {
    expect(await createTransactionCore(input, "bad-id")).toEqual({ ok: false, error: "invalid" });
    expect(await createTransactionCore({ ...input, amountMinor: 0 }, id)).toEqual({ ok: false, error: "invalid" });
    for (const revision of [0, -1, 1.5, Number.NaN, 2147483648]) {
      expect(await updateTransactionCore(id, input, revision)).toEqual({ ok: false, error: "invalid" });
    }
    expect(mock.actionClient).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns preview/session failures without a mutation or revalidation", async () => {
    for (const error of ["notConfigured", "failed"] as const) {
      mock.actionClient.mockResolvedValue({ error });
      expect(await createTransactionCore(input, id)).toEqual({ ok: false, error });
      expect(await updateTransactionCore(id, input, 1)).toEqual({ ok: false, error });
    }
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns conflicts without refreshing or silently retrying with a newer revision", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "BT003", message: "transaction conflict" } });
    expect(await updateTransactionCore(id, input, 4)).toEqual({ ok: false, error: "conflict" });
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not claim success for missing/malformed/foreign mutation results", async () => {
    for (const data of [null, [], [mutation, mutation], [{ id, revision: 0 }], [{ id, revision: "8" }], [{ id: walletId, revision: 8 }]]) {
      mock.rpc.mockResolvedValue({ data, error: null });
      expect(await createTransactionCore(input, id)).toEqual({ ok: false, error: "failed" });
    }
    expect(mock.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects update/lifecycle results older than the supplied concurrency token", async () => {
    mock.rpc.mockResolvedValue({ data: [{ id, revision: 4 }], error: null });
    expect(await updateTransactionCore(id, input, 4)).toEqual({ ok: false, error: "failed" });
    expect(await deleteTransactionCore(id, 5)).toEqual({ ok: false, error: "failed" });
    expect(mock.revalidatePath).not.toHaveBeenCalled();
    // Same-state lifecycle no-ops can legitimately return the exact token.
    expect(await restoreTransactionCore(id, 4)).toEqual({ ok: true, id, revision: 4 });
  });

  it("handles an unknown transport outcome without regenerating ID or revalidating", async () => {
    mock.rpc.mockRejectedValueOnce(new Error("transport failed"));
    expect(await createTransactionCore(input, id)).toEqual({ ok: false, error: "failed" });
    expect(mock.revalidatePath).not.toHaveBeenCalled();
    expect(await createTransactionCore(input, id)).toEqual({ ok: true, ...mutation });
    expect(mock.rpc.mock.calls.map(([, args]) => args.p_id)).toEqual([id, id]);
  });
});

describe("canonical lifecycle core", () => {
  it("uses only the captured expected revision and returns the actual resulting token", async () => {
    expect(await deleteTransactionCore(id, 3)).toEqual({ ok: true, ...mutation });
    expect(await restoreTransactionCore(id, 7)).toEqual({ ok: true, ...mutation });
    expect(mock.rpc.mock.calls).toEqual([
      ["set_transaction_deleted", { p_id: id, p_expected_revision: 3, p_deleted: true }],
      ["set_transaction_deleted", { p_id: id, p_expected_revision: 7, p_deleted: false }],
    ]);
  });

  it("rejects invalid lifecycle tokens before auth and does not refresh preview/failure", async () => {
    expect(await deleteTransactionCore(id, 0)).toEqual({ ok: false, error: "invalid" });
    expect(await restoreTransactionCore("bad", 1)).toEqual({ ok: false, error: "invalid" });
    expect(mock.actionClient).not.toHaveBeenCalled();
    mock.actionClient.mockResolvedValue({ error: "notConfigured" });
    expect(await deleteTransactionCore(id, 1)).toEqual({ ok: false, error: "notConfigured" });
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects stale Undo/restore instead of fetching a fresh revision or resurrecting", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "BT003", message: "transaction conflict" } });
    expect(await deleteTransactionCore(id, 3)).toEqual({ ok: false, error: "conflict" });
    expect(await restoreTransactionCore(id, 3)).toEqual({ ok: false, error: "conflict" });
    expect(mock.rpc).toHaveBeenCalledTimes(2);
    expect(mock.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("finite transaction mutation errors", () => {
  it.each([
    [{ code: "BT001" }, "breakdownExceedsTotal"], [{ code: "BT002" }, "breakdownCurrencyLocked"],
    [{ code: "BT003" }, "conflict"], [{ message: "category_unavailable" }, "categoryUnavailable"],
    [{ message: "category unavailable" }, "categoryUnavailable"], [{ message: "wallet unavailable" }, "walletUnavailable"],
    [{ message: "settlement mismatch" }, "settlementMismatch"], [{ message: "unsupported currency pair" }, "unsupportedPair"],
    [{ message: "exceeds remaining" }, "exceedsRemaining"], [{ message: "already paid this cycle" }, "alreadyPaidThisCycle"],
    [{ message: "salary cycle changed" }, "cycleChanged"], [{ message: "installment payment changed" }, "paymentChanged"],
    [{ message: "transaction request already used" }, "requestAlreadyUsed"], [{ message: "loan.managedTransaction" }, "managedTransaction"],
    [{ code: "22023", message: "invalid transaction input" }, "invalid"],
    [{ message: "unexpected private database detail" }, "failed"],
  ] as const)("maps %j to %s without exposing database text", (error, expected) => {
    expect(transactionMutationError(error)).toBe(expected);
  });
});
