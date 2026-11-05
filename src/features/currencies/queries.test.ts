import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), createClient: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/demo-data", () => ({ DEMO_CURRENCY_DEFINITIONS: [{ code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: false }] }));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { getCurrencies } from "./queries";

function catalogQuery(result: () => unknown) {
  const query: Record<string, unknown> = {};
  let after: string | null = null, limit = 1000;
  query.select = vi.fn().mockReturnValue(query);
  query.order = vi.fn().mockReturnValue(query);
  query.gt = vi.fn((_field: string, cursor: string) => { after = cursor; return query; });
  query.limit = vi.fn((size: number) => { limit = Math.min(size, 1000); return query; });
  query.then = (resolve: (value: unknown) => unknown) => {
    const page = result() as { data: Record<string, unknown>[] | null; error: unknown };
    return Promise.resolve({ ...page, data: page.data?.filter((row) => after === null || String(row.code) > after).sort((a, b) => String(a.code).localeCompare(String(b.code))).slice(0, limit) ?? null }).then(resolve);
  };
  return query;
}

let rows: Record<string, unknown>[];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  rows = [
    { code: "EUR", symbol: "€", decimal_places: 2, disabled_at: null, first_used_at: null, created_at: "2026-01-01" },
    { code: "BTC", symbol: "₿", decimal_places: 8, disabled_at: "2026-02-01", first_used_at: "2026-01-02", created_at: "2026-01-02" },
  ];
  mocks.from.mockReturnValue(catalogQuery(() => ({ data: rows, error: null })));
  mocks.createClient.mockResolvedValue({ from: mocks.from });
});

describe("getCurrencies", () => {
  it.each([
    { label: "zero fraction before one microsecond", first: "2026-11-05T12:00:00+00:00", second: "2026-11-05T12:00:00.000001+00:00", expected: ["ZZZ", "AAA"] },
    { label: "distinct submillisecond values override opposing code order", first: "2026-11-05T12:00:00.000001+00:00", second: "2026-11-05T12:00:00.000002+00:00", expected: ["ZZZ", "AAA"] },
    { label: "equal instants use code order despite fractional serialization", first: "2026-11-05T12:00:00.1+00:00", second: "2026-11-05T12:00:00.100000+00:00", expected: ["AAA", "ZZZ"] },
    { label: "UTC offsets preserve microsecond chronology", first: "2026-11-05T14:00:00.000001+02:00", second: "2026-11-05T12:00:00.000002+00:00", expected: ["ZZZ", "AAA"] },
  ])("orders catalog creation instants: $label", async ({ first, second, expected }) => {
    rows = [{ ...rows[0], code: "ZZZ", created_at: first }, { ...rows[0], code: "AAA", created_at: second }];
    expect((await getCurrencies()).map((currency) => currency.code)).toEqual(expected);
  });
  it("keeps the full catalog beyond the API cap in created-at then code order", async () => {
    rows = Array.from({ length: 1205 }, (_, n) => ({ code: `C${String(n).padStart(5, "0")}`, symbol: "C", decimal_places: 8, disabled_at: n % 2 === 0 ? null : "2026-01-01", first_used_at: null, created_at: n === 1204 ? "2025-01-01" : "2026-01-01" }));
    const catalog = await getCurrencies();
    expect(catalog).toHaveLength(1205);
    expect(catalog[0]).toMatchObject({ code: "C01204", decimalPlaces: 8 });
    expect(catalog[1].code).toBe("C00000");
    expect(catalog.at(-1)?.code).toBe("C01203");
  });
  it("maps custom definitions in catalog addition order", async () => {
    await expect(getCurrencies()).resolves.toEqual([
      { code: "EUR", symbol: "€", decimalPlaces: 2, disabled: false, firstUsed: false },
      { code: "BTC", symbol: "₿", decimalPlaces: 8, disabled: true, firstUsed: true },
    ]);
  });

  it.each([
    ["invalid code", { code: "bad" }], ["empty symbol", { symbol: "" }], ["precision above eight", { decimal_places: 9 }],
  ])("rejects a malformed catalog row: %s", async (_label, change) => {
    rows[0] = { ...rows[0], ...change };
    await expect(getCurrencies()).rejects.toThrow("Currency data unavailable");
  });

  it("does not replace a configured catalog failure with built-ins", async () => {
    mocks.from.mockReturnValue(catalogQuery(() => ({ data: null, error: { message: "private details" } })));
    await expect(getCurrencies()).rejects.toThrow("Currency data unavailable");
  });

  it("uses valid demo definitions only when Supabase is unconfigured", async () => {
    mocks.configured.mockReturnValue(false);
    await expect(getCurrencies()).resolves.toEqual([{ code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: false }]);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
