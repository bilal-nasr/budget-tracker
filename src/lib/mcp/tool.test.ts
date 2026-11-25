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

// Every tool and its kind. A new tool is added here on purpose: a delete, void or balance
// adjustment must be "destructive" so the client asks before running it.
const EXPECTED_KINDS: Record<string, "read" | "write" | "destructive"> = {
  budgets_delete: "destructive", budgets_get: "read", budgets_set: "write",
  categories_create: "write", categories_delete: "destructive", categories_list: "read", categories_restore: "write", categories_update: "write",
  currencies_list: "read",
  fixed_expenses_create: "write", fixed_expenses_delete: "destructive", fixed_expenses_list: "read", fixed_expenses_update: "write",
  installments_create: "write", installments_delete: "destructive", installments_list: "read", installments_update: "write",
  invoices_folder_get: "read", invoices_folders_create: "write", invoices_folders_delete: "destructive", invoices_folders_list: "read", invoices_folders_update: "write",
  loans_create: "write", loans_delete: "destructive", loans_delete_payment: "destructive", loans_history: "read", loans_list: "read",
  loans_record_payment: "write", loans_update: "write",
  pending_payments_create: "write", pending_payments_delete: "destructive", pending_payments_list: "read", pending_payments_receipts: "read",
  pending_payments_record_receipt: "write", pending_payments_update: "write",
  profile_get: "read", profile_update: "write",
  salary_mark_received: "write", salary_status_get: "read", salary_update: "write",
  shopping_items_create: "write", shopping_items_delete: "destructive", shopping_items_list: "read", shopping_items_update: "write",
  summary_get: "read",
  transactions_create: "write", transactions_delete: "destructive", transactions_list: "read", transactions_restore: "write", transactions_update: "write",
  wallets_adjust_balance: "destructive", wallets_create: "write", wallets_delete: "destructive", wallets_list: "read", wallets_update: "write",
};

test("registry: exactly the expected tools, unique snake_case names, each with its kind", () => {
  const names = allTools.map((tool) => tool.name);
  expect([...names].sort()).toEqual(Object.keys(EXPECTED_KINDS).sort());
  expect(names).toHaveLength(55);
  expect(new Set(names).size).toBe(names.length);
  for (const tool of allTools) {
    expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)+$/);
    expect(`${tool.name}: ${tool.kind}`).toBe(`${tool.name}: ${EXPECTED_KINDS[tool.name]}`);
    expect(tool.title.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeGreaterThan(0);
  }
});

test("registry: every delete, void and balance adjustment is destructive; nothing that only reads is", () => {
  for (const tool of allTools) {
    if (/_(delete|delete_payment|adjust_balance)$/.test(tool.name)) expect(`${tool.name}: ${tool.kind}`).toBe(`${tool.name}: destructive`);
    if (/_(list|get|history|receipts)$/.test(tool.name)) expect(`${tool.name}: ${tool.kind}`).toBe(`${tool.name}: read`);
  }
});

test("registry: every write tool has a strict input schema that refuses unknown keys, and every create takes a requestId", () => {
  for (const tool of allTools.filter((candidate) => candidate.kind !== "read")) {
    expect(tool.input, tool.name).toBeDefined();
    expect(tool.input!.safeParse({ notAField: 1 }).success, tool.name).toBe(false);
    // What a client is shown: the schema of what it sends (before trims and other transforms).
    const shape = z.toJSONSchema(tool.input!, { io: "input" }) as { properties?: Record<string, unknown>; additionalProperties?: unknown };
    expect(shape.additionalProperties, tool.name).toBe(false);
    if (/_(create|record_payment|record_receipt|mark_received)$/.test(tool.name)) expect(Object.keys(shape.properties ?? {}), tool.name).toContain("requestId");
  }
});
