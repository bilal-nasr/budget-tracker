import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), createClient: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/demo-data", () => ({ DEMO_CURRENCIES: [{ code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: false }] }));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { getCurrencies } from "./queries";

function catalogQuery(result: () => unknown) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn().mockReturnValue(query);
  query.order = vi.fn().mockReturnValue(query);
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
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
