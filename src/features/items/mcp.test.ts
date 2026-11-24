import { beforeEach, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));
const getShoppingItems = vi.fn();
const getCurrencies = vi.fn();
vi.mock("./queries", () => ({ getShoppingItems: () => getShoppingItems() }));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
import { itemTools } from "./mcp";

beforeEach(() => {
  vi.resetAllMocks();
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
});

test("shopping_items_list shows the unit price and the line total (price times quantity)", async () => {
  getShoppingItems.mockResolvedValue([
    { id: "a", name: "Notebook", currency: "USD", priceMinor: 150, quantity: 3, createdAt: "x", boughtOn: null, transactionId: null },
    { id: "b", name: "Bread", currency: "LBP", priceMinor: 45000, quantity: 2, createdAt: "x", boughtOn: "2026-11-02", transactionId: "t" },
  ]);
  const [tool] = itemTools;
  expect(tool.name).toBe("shopping_items_list");
  expect(tool.kind).toBe("read");
  const out = (await tool.run({})) as { items: Record<string, unknown>[] };
  expect(out.items[0]).toMatchObject({
    priceMinor: 150, price: { minor: 150, currency: "USD", text: "$1.50" }, lineTotal: { minor: 450, currency: "USD", text: "$4.50" },
  });
  expect(out.items[1]).toMatchObject({ lineTotal: { minor: 90000, currency: "LBP", text: "LBP 90,000" } });
});
