import { beforeEach, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));
const getCurrencies = vi.fn();
vi.mock("./queries", () => ({ getCurrencies: () => getCurrencies() }));
import { currencyTools } from "./mcp";

beforeEach(() => getCurrencies.mockReset());

test("currencies_list returns the person's currencies", async () => {
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
  const [tool] = currencyTools;
  expect(tool.name).toBe("currencies_list");
  expect(tool.kind).toBe("read");
  await expect(tool.run({})).resolves.toEqual({ currencies: SEED_CURRENCY_DEFINITIONS });
});
