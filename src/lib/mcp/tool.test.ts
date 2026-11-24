import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { SEED_CURRENCY_DEFINITIONS, requireCurrency } from "@/lib/currency";

vi.mock("server-only", () => ({}));
import { defineTool, moneyOut, toResult, toolAnnotations } from "./tool";
import { allTools } from "./registry";

describe("toResult", () => {
  test("wraps arrays as { items }", () => {
    const result = toResult([{ id: 1 }, { id: 2 }]);
    expect(result.structuredContent).toEqual({ items: [{ id: 1 }, { id: 2 }] });
    expect(JSON.parse(result.content[0].text)).toEqual({ items: [{ id: 1 }, { id: 2 }] });
    expect(result.content[0].type).toBe("text");
  });

  test("passes objects through as structured content", () => {
    const result = toResult({ locale: "en", salary: null });
    expect(result.structuredContent).toEqual({ locale: "en", salary: null });
    expect(JSON.parse(result.content[0].text)).toEqual({ locale: "en", salary: null });
  });

  test("primitives and nothing return text only", () => {
    expect(toResult(3)).toEqual({ content: [{ type: "text", text: "3" }] });
    expect(toResult(undefined)).toEqual({ content: [{ type: "text", text: "null" }] });
    expect(toResult(null)).toEqual({ content: [{ type: "text", text: "null" }] });
  });
});

test("moneyOut keeps the integer and adds an English, Latin-digit text", () => {
  const usd = requireCurrency("USD", SEED_CURRENCY_DEFINITIONS);
  const lbp = requireCurrency("LBP", SEED_CURRENCY_DEFINITIONS);
  expect(moneyOut(123456, usd)).toEqual({ minor: 123456, currency: "USD", text: "$1,234.56" });
  expect(moneyOut(-89500, lbp)).toEqual({ minor: -89500, currency: "LBP", text: "−LBP 89,500" });
});

test("annotations follow the tool kind", () => {
  expect(toolAnnotations("read")).toEqual({ readOnlyHint: true });
  expect(toolAnnotations("write")).toEqual({ readOnlyHint: false, destructiveHint: false });
  expect(toolAnnotations("destructive")).toEqual({ readOnlyHint: false, destructiveHint: true });
});

test("defineTool keeps the definition and types run's args from the input", async () => {
  const tool = defineTool({
    name: "demo_echo",
    title: "Echo",
    description: "Echoes.",
    kind: "read",
    input: z.object({ word: z.string() }),
    run: async ({ word }) => word.toUpperCase(),
  });
  expect(tool.name).toBe("demo_echo");
  await expect(tool.run({ word: "hi" })).resolves.toBe("HI");
});

test("registry names are unique, snake_case, and every Phase 1 tool is kind 'read'", () => {
  const names = allTools.map((tool) => tool.name);
  expect(names.sort()).toEqual([
    "budgets_get", "categories_list", "currencies_list", "fixed_expenses_list", "installments_list", "invoices_folder_get",
    "invoices_folders_list", "loans_history", "loans_list", "pending_payments_list", "pending_payments_receipts",
    "profile_get", "salary_status_get", "shopping_items_list", "summary_get", "transactions_list", "wallets_list",
  ]);
  expect(names).toHaveLength(17);
  expect(new Set(names).size).toBe(names.length);
  for (const tool of allTools) {
    expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)+$/);
    expect(tool.kind).toBe("read");
    expect(tool.title.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeGreaterThan(0);
  }
});
