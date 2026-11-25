import { beforeEach, describe, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));

// A tiny stand-in for the person's own connector_requests rows (what RLS would leave visible).
type Row = { request_id: string; tool: string; result: unknown };
const rows: Row[] = [];
const failing = { insert: null as null | { code: string }, select: false };
const calls: string[] = [];
const table = {
  insert: async (row: { request_id: string; tool: string }) => {
    calls.push("insert");
    if (failing.insert) return { error: failing.insert };
    if (rows.some((r) => r.request_id === row.request_id)) return { error: { code: "23505" } };
    rows.push({ ...row, result: null });
    return { error: null };
  },
  select: () => ({
    eq: (_column: string, id: string) => ({
      maybeSingle: async () => {
        calls.push("select");
        if (failing.select) return { data: null, error: { code: "XX000" } };
        return { data: rows.find((r) => r.request_id === id) ?? null, error: null };
      },
    }),
  }),
  update: (patch: { result: unknown }) => ({
    eq: async (_column: string, id: string) => {
      calls.push("update");
      const row = rows.find((r) => r.request_id === id);
      if (row) row.result = patch.result;
      return { error: null };
    },
  }),
  delete: () => ({
    eq: async (_column: string, id: string) => {
      calls.push("delete");
      const at = rows.findIndex((r) => r.request_id === id);
      if (at >= 0) rows.splice(at, 1);
      return { error: null };
    },
  }),
};
const from = vi.fn((name: string) => {
  if (name !== "connector_requests") throw new Error(`unexpected table ${name}`);
  return table;
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));
const getWallets = vi.fn();
vi.mock("@/features/wallets/queries", () => ({ getWallets: (options: unknown) => getWallets(options) }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: async () => SEED_CURRENCY_DEFINITIONS }));

import type { ActionError } from "@/lib/supabase/action";
import { ToolError } from "./tool";
import {
  ACTION_ERROR_TEXT, REQUEST_REUSED_TEXT, REQUEST_UNKNOWN_TEXT, UnknownOutcomeError, balancesOut, once, requestIdSchema, unwrap,
} from "./write";

const ID = "7b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";

beforeEach(() => {
  rows.length = 0;
  calls.length = 0;
  failing.insert = null;
  failing.select = false;
  from.mockClear();
  getWallets.mockReset();
});

describe("unwrap", () => {
  test("returns a success as it is", () => {
    expect(unwrap({ ok: true as const, id: "x" })).toEqual({ ok: true, id: "x" });
  });

  test("a known error becomes a ToolError with its fixed sentence", () => {
    const run = () => unwrap({ ok: false, error: "conflict" });
    expect(run).toThrow(ToolError);
    expect(run).toThrow(ACTION_ERROR_TEXT.conflict);
    expect(() => unwrap({ ok: false, error: "walletNonzero" })).not.toThrow(UnknownOutcomeError);
  });

  test("`failed` and unknown codes are an unknown outcome, never the raw text", () => {
    expect(() => unwrap({ ok: false, error: "failed" })).toThrow(UnknownOutcomeError);
    const run = () => unwrap({ ok: false, error: "relation \"wallets\" does not exist" });
    expect(run).toThrow(UnknownOutcomeError);
    expect(run).toThrow(ACTION_ERROR_TEXT.failed);
  });

  test("every action error has one non-empty English sentence", () => {
    // Record<ActionError, string> makes a missing code a type error; this pins the texts' form.
    const codes = Object.keys(ACTION_ERROR_TEXT) as ActionError[];
    expect(codes.length).toBeGreaterThan(40);
    for (const code of codes) expect(ACTION_ERROR_TEXT[code]).toMatch(/^[A-Z][^\n]+\.$/);
  });
});

test("requestIdSchema takes a UUID or nothing", () => {
  expect(requestIdSchema.safeParse(undefined).success).toBe(true);
  expect(requestIdSchema.safeParse(ID).success).toBe(true);
  expect(requestIdSchema.safeParse("retry-1").success).toBe(false);
});

describe("once", () => {
  test("without a requestId it only runs", async () => {
    const run = vi.fn(async () => ({ id: "a" }));
    await expect(once("wallets_create", undefined, run)).resolves.toEqual({ id: "a" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });

  test("claims first, runs, records the result; a repeat replays it without running", async () => {
    const run = vi.fn(async () => {
      expect(calls).toEqual(["insert"]);
      return { id: "a", name: "Pocket" };
    });
    await expect(once("wallets_create", ID, run)).resolves.toEqual({ id: "a", name: "Pocket" });
    expect(rows).toEqual([{ request_id: ID, tool: "wallets_create", result: { id: "a", name: "Pocket" } }]);
    await expect(once("wallets_create", ID, run)).resolves.toEqual({ id: "a", name: "Pocket", replayed: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("the same requestId from another tool is refused and nothing runs", async () => {
    await once("wallets_create", ID, async () => ({ id: "a" }));
    const run = vi.fn(async () => ({ id: "b" }));
    await expect(once("categories_create", ID, run)).rejects.toThrow(REQUEST_REUSED_TEXT);
    expect(run).not.toHaveBeenCalled();
  });

  test("a definite refusal releases the claim, so the same id can be retried", async () => {
    await expect(once("wallets_create", ID, async () => unwrap({ ok: false, error: "duplicateName" }))).rejects.toThrow(ACTION_ERROR_TEXT.duplicateName);
    expect(rows).toEqual([]);
    await expect(once("wallets_create", ID, async () => ({ id: "a" }))).resolves.toEqual({ id: "a" });
  });

  test("an unknown outcome keeps the claim: a retry is told to check and never runs again", async () => {
    await expect(once("wallets_create", ID, async () => unwrap({ ok: false, error: "failed" }))).rejects.toThrow(UnknownOutcomeError);
    await expect(once("wallets_create", ID, async () => { throw new Error("socket hang up"); })).rejects.toThrow(REQUEST_UNKNOWN_TEXT);
    expect(rows).toEqual([{ request_id: ID, tool: "wallets_create", result: null }]);
    const run = vi.fn(async () => ({ id: "a" }));
    await expect(once("wallets_create", ID, run)).rejects.toThrow(REQUEST_UNKNOWN_TEXT);
    expect(run).not.toHaveBeenCalled();
  });

  test("an unexpected throw keeps the claim too", async () => {
    await expect(once("wallets_create", ID, async () => { throw new Error("socket hang up"); })).rejects.toThrow("socket hang up");
    expect(rows).toHaveLength(1);
  });

  test("when the claim cannot be made nothing runs", async () => {
    failing.insert = { code: "42501" };
    const run = vi.fn(async () => ({ id: "a" }));
    const attempt = once("wallets_create", ID, run);
    await expect(attempt).rejects.toThrow("Request claim failed");
    await expect(attempt).rejects.not.toBeInstanceOf(ToolError);
    expect(run).not.toHaveBeenCalled();
  });

  test("when an earlier claim cannot be read nothing runs", async () => {
    await once("wallets_create", ID, async () => ({ id: "a" }));
    failing.select = true;
    const run = vi.fn(async () => ({ id: "b" }));
    await expect(once("wallets_create", ID, run)).rejects.toThrow("Request lookup failed");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("balancesOut", () => {
  const balance = (id: string, walletId: string, currency: string, balanceMinor: number) => ({
    id, walletId, currency, openingBalanceMinor: 0, balanceMinor, position: 0, detached: false,
  });
  const wallets = [
    { id: "w1", name: "Pocket", kind: "cash", position: 0, deleted: false, needsAttention: false, defaultBalanceId: "b1",
      balances: [balance("b1", "w1", "USD", 1250), balance("b2", "w1", "LBP", 4250000)] },
    { id: "w2", name: "Bank", kind: "bank", position: 1, deleted: false, needsAttention: false, defaultBalanceId: "b3",
      balances: [balance("b3", "w2", "USD", 900)] },
  ];

  test("every wallet when no ids are given, one amount per currency", async () => {
    getWallets.mockResolvedValue(wallets);
    const out = await balancesOut();
    expect(getWallets).toHaveBeenCalledWith({});
    expect(out).toHaveLength(2);
    expect(out[0].balances.map((b) => b.amount)).toEqual([
      { minor: 1250, currency: "USD", text: "$12.50" },
      { minor: 4250000, currency: "LBP", text: "LBP 4,250,000" },
    ]);
  });

  test("only the wallets holding the given balances, deleted ones included", async () => {
    getWallets.mockResolvedValue(wallets);
    const out = await balancesOut(["b3"]);
    expect(getWallets).toHaveBeenCalledWith({ includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true });
    expect(out.map((wallet) => wallet.id)).toEqual(["w2"]);
  });
});
