import ExcelJS from "exceljs";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { GET } from "./route";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let selections: Array<{ table: string; columns: string }>;

// Replace only the authenticated owner's database client. Canonical catalog,
// wallet, transaction, export readers and the XLSX writer all run unchanged.
beforeEach(() => {
  selections = [];
  tables = {
    profiles: [], categories: [], budgets: [], loan_overview: [], pending_payment_progress: [],
    currencies: [
      { code: "USD", symbol: "＄", decimal_places: 3, disabled_at: null, first_used_at: "2026-01-01", created_at: "2026-01-01T00:00:00.000002Z" },
      { code: "TOK", symbol: "🪙ت", decimal_places: 8, disabled_at: "2026-01-02", first_used_at: "2026-01-01", created_at: "2026-01-01T00:00:00.000001Z" },
    ],
    wallets: [
      { id: "closed", name: "Closed wallet", kind: "cash", default_balance_id: "usd", position: 0, deleted_at: "2026-02-01", needs_attention: false, created_at: "2026-01-01" },
      { id: "empty", name: "Empty tombstone", kind: "bank", default_balance_id: null, position: 1, deleted_at: "2026-02-01", needs_attention: false, created_at: "2026-01-02" },
    ],
    wallet_balances: [
      { id: "usd", wallet_id: "closed", currency: "USD", opening_balance_minor: "0", position: 0, detached_at: null, created_at: "2026-01-01" },
      { id: "token-history", wallet_id: "closed", currency: "TOK", opening_balance_minor: "123456789", position: 1, detached_at: "2026-01-02", created_at: "2026-01-01" },
    ],
    wallet_balance_totals: [
      { balance_id: "usd", wallet_id: "closed", currency: "USD", balance_minor: "0" },
      { balance_id: "token-history", wallet_id: "closed", currency: "TOK", balance_minor: "0" },
    ],
    fixed_expenses: [{ id: "fixed", name: "Custom fixed", amount_minor: "123456789", balance_id: "token-history", category_id: "unused-category", due_day: null, items: [] }],
    transactions: [{ id: "transaction", kind: "expense", occurred_on: "2026-01-01", amount_minor: "123456789", currency: "TOK", cost_currency: "TOK", balance_id: "token-history", category_id: null, to_balance_id: null, to_amount_minor: null, wallet_name_snapshot: "At payment", to_wallet_name_snapshot: null, note: null, created_at: "2026-01-01T00:00:00Z", revision: 1, source: null, fixed_expense_id: null, installment_id: null, loan_id: null, loan_flow: null, loan_event: null, loan_principal_minor: null, loan_fee_minor: null, loan_event_seq: null, tender_minor: null, cashier_changes: [], expense_items: [], pending_payment_id: null }],
  };
  mocks.createClient.mockResolvedValue({
    auth: { getClaims: async () => ({ data: { claims: { sub: "owner-id" } } }) },
    rpc: async (name: string) => {
      expect(name).toBe("installment_cycle_snapshot");
      return { data: { receipt: null, installments: [], payments: [] }, error: null };
    },
    from: (table: string) => {
      if (!(table in tables)) throw new Error(`Unexpected table: ${table}`);
      let columns = "", key = "id", after: string | null = null, limit = 1000;
      const query: Record<string, unknown> = {};
      query.select = (value: string) => { columns = value; selections.push({ table, columns }); return query; };
      for (const method of ["eq", "is", "lte", "range"]) query[method] = () => query;
      query.order = (value: string) => { key = value; return query; };
      query.gt = (_field: string, value: string) => { after = value; return query; };
      query.limit = (value: number) => { limit = Math.min(value, 1000); return query; };
      query.maybeSingle = async () => ({ data: null, error: null });
      query.then = (resolve: (result: unknown) => unknown) => {
        const rows = [...tables[table]].sort((a, b) => String(a[key]).localeCompare(String(b[key])))
          .filter((row) => after === null || String(row[key]) > after).slice(0, limit);
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      };
      return query;
    },
  });
});

function request() {
  return GET(new Request("https://budget.example/en/settings/export"), {
    params: Promise.resolve({ locale: "en" }),
  } as RouteContext<"/[locale]/settings/export">);
}

it("downloads runtime owner facts through canonical balance columns with catalog microsecond order and empty tombstones", async () => {
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("private");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  expect(workbook.getWorksheet("Currency Catalog")!.getCell("A5").value).toBe("TOK");
  expect(workbook.getWorksheet("Currency Catalog")!.getCell("B5").value).toBe("🪙ت");
  expect(workbook.getWorksheet("Transactions")!.getCell("E5").value).toBe("token-history");
  expect(workbook.getWorksheet("Transactions")!.getCell("I5").value).toBe(1.23456789);
  expect(workbook.getWorksheet("Wallets")!.getCell("B6").value).toBe("empty");
  expect(workbook.getWorksheet("Balances")!.getCell("B5").value).toBe("token-history");
  expect(selections.some((row) => row.table === "fixed_expenses" && row.columns.includes("balance_id"))).toBe(true);
  expect(selections.some((row) => row.table === "transactions" && row.columns.includes("balance_id"))).toBe(true);
});

it("includes the complete catalog beyond the default database cap", async () => {
  tables.currencies.push(...Array.from({ length: 1205 }, (_, index) => ({
    code: `C${String(index).padStart(4, "0")}`, symbol: "◈", decimal_places: index % 9,
    disabled_at: index % 2 ? "2026-01-02" : null, first_used_at: null, created_at: "2026-01-01T00:00:00.000003Z",
  })));
  const response = await request();
  expect(response.status).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  const catalog = workbook.getWorksheet("Currency Catalog")!;
  expect(catalog.getCell("A5").value).toBe("TOK");
  expect(catalog.getCell("A6").value).toBe("USD");
  expect(catalog.getCell("A1211").value).toBe("C1204");
  expect(catalog.rowCount).toBe(1211);
}, 15_000);

it("returns a private generic failure when an exact history definition is absent", async () => {
  tables.currencies = tables.currencies.filter((row) => row.code !== "TOK");
  const response = await request();
  expect(response.status).toBe(500);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).toEqual({ error: "exportUnavailable" });
});
