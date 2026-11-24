import { beforeEach, expect, test, vi } from "vitest";
const mock = vi.hoisted(() => ({ createClient: vi.fn(), configured: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mock.createClient }));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: mock.configured }));
import { runAsConnector } from "@/lib/supabase/request-context";
import { getFixedExpenses } from "./queries";

type Result = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Result => ({ data, error: null });
const failed: Result = { data: null, error: { message: "boom" } };
const FIXED = [{ id: "f1", name: "Rent", amount_minor: "50000", balance_id: "b1", category_id: "c1", due_day: 1, items: [] }];

/** A chainable PostgREST stand-in: every builder call returns itself; awaiting (or maybeSingle) gives `result`. */
function builder(result: Result) {
  const q: Record<string, unknown> = {};
  for (const key of ["select", "eq", "is", "order", "limit", "gte"]) q[key] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => result);
  q.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return q;
}

/** Results in call order: receipt, paid, fixed_expenses. */
function stubDatabase(receipt: Result, paid: Result, items: Result) {
  const queue = [receipt, paid];
  mock.createClient.mockResolvedValue({
    from: vi.fn((table: string) => builder(table === "fixed_expenses" ? items : queue.shift()!)),
  });
}

const asConnector = <T>(fn: () => Promise<T>) => runAsConnector({ accessToken: "t", userId: "u" }, fn);

beforeEach(() => {
  vi.clearAllMocks();
  mock.configured.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

test("reads paidOn from the newest fixed payment in the cycle", async () => {
  stubDatabase(ok({ created_at: "2026-11-01T08:00:00Z" }), ok([{ fixed_expense_id: "f1", occurred_on: "2026-11-02" }]), ok(FIXED));
  await expect(getFixedExpenses("Asia/Beirut")).resolves.toMatchObject([{ id: "f1", amountMinor: 50000, paidOn: "2026-11-02" }]);
});

test("a browser request keeps today's fallbacks on a database error", async () => {
  stubDatabase(ok(null), ok([]), failed);
  await expect(getFixedExpenses("Asia/Beirut")).resolves.toEqual([]);
  stubDatabase(ok(null), failed, ok(FIXED));
  await expect(getFixedExpenses("Asia/Beirut")).resolves.toMatchObject([{ id: "f1", paidOn: null }]);
});

test("a connector request throws when the fixed expenses cannot be read", async () => {
  stubDatabase(ok(null), ok([]), failed);
  await expect(asConnector(() => getFixedExpenses("Asia/Beirut"))).rejects.toThrow(Error);
});

test("a connector request throws when the paid lookup fails, instead of reporting everything unpaid", async () => {
  stubDatabase(ok(null), failed, ok(FIXED));
  await expect(asConnector(() => getFixedExpenses("Asia/Beirut"))).rejects.toThrow(Error);
});

test("a connector request throws when the salary receipt lookup fails, instead of falling back to the calendar month", async () => {
  stubDatabase(failed, ok([]), ok(FIXED));
  await expect(asConnector(() => getFixedExpenses("Asia/Beirut"))).rejects.toThrow(Error);
});
