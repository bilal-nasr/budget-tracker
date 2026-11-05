import ExcelJS from "exceljs";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { GET } from "./route";

let categories: Record<string, unknown>[];

// Only the database boundary is replaced: exercise authentication, snapshot
// collection, category validation and XLSX serialization through the real route.
beforeEach(() => {
  categories = [1, 8, 9, 10, 11, 12, 13, 14, 15].map((tile) => ({
    id: `category-${String(tile).padStart(2, "0")}`, kind: "expense",
    name_en: `Category ${tile}`, name_ar: `فئة ${tile}`, tile, color: "teal",
    position: tile, parent_id: null, archived_at: tile === 15 ? "2026-11-01T00:00:00Z" : null,
  }));
  mocks.createClient.mockResolvedValue({
    auth: { getClaims: async () => ({ data: { claims: { sub: "user-id" } } }) },
    rpc: async (name: string) => {
      if (name !== "installment_cycle_snapshot") throw new Error(`Unexpected RPC: ${name}`);
      return { data: { receipt: null, installments: [], payments: [] }, error: null };
    },
    from: (table: string) => {
      const tables: Record<string, unknown[]> = {
        categories, profiles: [], currencies: [], wallets: [], wallet_balances: [], wallet_balance_totals: [],
        transactions: [], budgets: [], fixed_expenses: [], loan_overview: [], pending_payment_progress: [],
      };
      if (!(table in tables)) throw new Error(`Unexpected table: ${table}`);
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "lte", "gt", "order", "limit", "range"]) {
        query[method] = () => query;
      }
      query.maybeSingle = async () => ({ data: null, error: null });
      query.then = (resolve: (result: unknown) => unknown) =>
        Promise.resolve({ data: tables[table], error: null }).then(resolve);
      return query;
    },
  });
});

function request(locale: "en" | "ar") {
  return GET(new Request(`https://budget.example/${locale}/settings/export`), {
    params: Promise.resolve({ locale }),
  } as RouteContext<"/[locale]/settings/export">);
}

it.each(["en", "ar"] as const)("downloads a readable %s workbook for categories using the newer icons", async (locale) => {
  const response = await request(locale);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  const sheet = workbook.getWorksheet(locale === "en" ? "Categories" : "الفئات")!;
  const values = sheet.getSheetValues().flat();
  for (const tile of [1, 8, 9, 10, 11, 12, 13, 14, 15]) {
    expect(values).toContain(`category-${String(tile).padStart(2, "0")}`);
    expect(values).toContain(locale === "en" ? `Category ${tile}` : `فئة ${tile}`);
  }
});

it.each([0, 16, 1.5, "9"])("rejects the invalid category icon %s without returning a partial workbook", async (tile) => {
  categories[0].tile = tile;
  const response = await request("en");
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "exportUnavailable" });
});
