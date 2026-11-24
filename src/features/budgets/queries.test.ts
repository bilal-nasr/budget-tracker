import { beforeEach, expect, test, vi } from "vitest";
const mock = vi.hoisted(() => ({ createClient: vi.fn(), configured: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mock.createClient }));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: mock.configured }));
vi.mock("@/features/categories/queries", () => ({ getCategories: vi.fn(async () => []) }));
import { runAsConnector } from "@/lib/supabase/request-context";
import { getSalaryReceiptDates } from "./queries";

type Result = { data: unknown; error: { message: string } | null };
function stub(result: Result) {
  const q: Record<string, unknown> = {};
  for (const key of ["select", "eq", "is", "order", "limit"]) q[key] = vi.fn(() => q);
  q.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  mock.createClient.mockResolvedValue({ from: vi.fn(() => q) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.configured.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

test("returns the receipt dates", async () => {
  stub({ data: [{ occurred_on: "2026-11-01" }], error: null });
  await expect(getSalaryReceiptDates()).resolves.toEqual(["2026-11-01"]);
});

test("a browser request keeps the calendar-month fallback (empty list) on a database error", async () => {
  stub({ data: null, error: { message: "boom" } });
  await expect(getSalaryReceiptDates()).resolves.toEqual([]);
});

test("a connector request throws on a database error", async () => {
  stub({ data: null, error: { message: "boom" } });
  await expect(runAsConnector({ accessToken: "t", userId: "u" }, () => getSalaryReceiptDates())).rejects.toThrow(Error);
});
