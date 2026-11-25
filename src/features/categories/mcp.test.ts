import { beforeEach, expect, test, vi } from "vitest";
import { ACTION_ERROR_TEXT } from "@/lib/mcp/write";
import { ToolError } from "@/lib/mcp/tool";

vi.mock("server-only", () => ({}));
const getCategories = vi.fn();
const createCategory = vi.fn();
const updateCategory = vi.fn();
const removeCategory = vi.fn();
const restoreCategory = vi.fn();
vi.mock("./queries", () => ({ getCategories: () => getCategories() }));
vi.mock("./actions", () => ({
  createCategory: (...a: unknown[]) => createCategory(...a),
  updateCategory: (...a: unknown[]) => updateCategory(...a),
  removeCategory: (...a: unknown[]) => removeCategory(...a),
  restoreCategory: (...a: unknown[]) => restoreCategory(...a),
}));
// A stand-in for the person's connector_requests rows, for the replay test.
const rows: { request_id: string; tool: string; result: unknown }[] = [];
const table = {
  insert: async (row: { request_id: string; tool: string }) => {
    if (rows.some((r) => r.request_id === row.request_id)) return { error: { code: "23505" } };
    rows.push({ ...row, result: null });
    return { error: null };
  },
  select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: rows.find((r) => r.request_id === id) ?? null, error: null }) }) }),
  update: (patch: { result: unknown }) => ({ eq: async (_c: string, id: string) => { const r = rows.find((x) => x.request_id === id); if (r) r.result = patch.result; return { error: null }; } }),
  delete: () => ({ eq: async () => ({ error: null }) }),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => table }) }));
import { categoryTools } from "./mcp";

const tool = (name: string) => categoryTools.find((t) => t.name === name)!;
const ID = "7b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const REQUEST = "11111111-2222-4333-8444-555555555555";
const food = { id: ID, kind: "expense", nameEn: "Food", nameAr: null, tile: 3, color: "teal", position: 1, parentId: null, archivedAt: null };

beforeEach(() => {
  vi.resetAllMocks();
  rows.length = 0;
  getCategories.mockResolvedValue([food]);
});

test("categories_list returns the categories", async () => {
  const categories = [{ id: "c1", kind: "expense", nameEn: "Food", nameAr: "طعام", parentId: null, archivedAt: null }];
  getCategories.mockResolvedValue(categories);
  const [first] = categoryTools;
  expect(first.name).toBe("categories_list");
  expect(first.kind).toBe("read");
  await expect(first.run({})).resolves.toEqual({ categories });
});

test("kinds", () => {
  expect(tool("categories_create").kind).toBe("write");
  expect(tool("categories_update").kind).toBe("write");
  expect(tool("categories_restore").kind).toBe("write");
  expect(tool("categories_delete").kind).toBe("destructive");
});

test("categories_create maps arguments and returns the new category", async () => {
  createCategory.mockResolvedValue({ ok: true, id: ID });
  const out = await tool("categories_create").run({ kind: "expense", nameEn: "Food", tile: 3, color: "teal" });
  expect(createCategory).toHaveBeenCalledWith({ kind: "expense", nameEn: "Food", nameAr: null, tile: 3, color: "teal" });
  expect(out).toEqual({ category: food });
});

test("categories_create turns an action error into the fixed sentence", async () => {
  createCategory.mockResolvedValue({ ok: false, error: "duplicateName" });
  await expect(tool("categories_create").run({ kind: "expense", nameEn: "Food", tile: 3, color: "teal" })).rejects.toThrow(new ToolError(ACTION_ERROR_TEXT.duplicateName));
});

test("categories_create does not create twice for the same requestId", async () => {
  createCategory.mockResolvedValue({ ok: true, id: ID });
  const args = { requestId: REQUEST, kind: "expense", nameEn: "Food", tile: 3, color: "teal" };
  const first = await tool("categories_create").run(args);
  const second = await tool("categories_create").run(args);
  expect(createCategory).toHaveBeenCalledTimes(1);
  expect(second).toEqual({ ...(first as object), replayed: true });
});

test("categories_create input rejects unknown keys and bad values", () => {
  const input = tool("categories_create").input!;
  const ok = { kind: "expense", nameEn: "Food", tile: 3, color: "teal" };
  expect(input.safeParse(ok).success).toBe(true);
  expect(input.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  expect(input.safeParse({ ...ok, tile: 16 }).success).toBe(false);
  expect(input.safeParse({ ...ok, color: "red" }).success).toBe(false);
  expect(input.safeParse({ ...ok, kind: "other" }).success).toBe(false);
  expect(input.safeParse({ ...ok, nameEn: "x".repeat(41) }).success).toBe(false);
  expect(input.safeParse({ ...ok, nameEn: null }).success).toBe(false);
  expect(input.safeParse({ ...ok, requestId: "nope" }).success).toBe(false);
});

test("categories_update fills omitted fields from the current row", async () => {
  updateCategory.mockResolvedValue({ ok: true });
  const out = await tool("categories_update").run({ id: ID, nameAr: "طعام" });
  expect(updateCategory).toHaveBeenCalledWith(ID, { nameEn: "Food", nameAr: "طعام", tile: 3, color: "teal" });
  expect(out).toEqual({ category: food });
});

test("categories_update passes an explicit null to clear a name", async () => {
  updateCategory.mockResolvedValue({ ok: true });
  await tool("categories_update").run({ id: ID, nameAr: null, color: "ochre" });
  expect(updateCategory).toHaveBeenCalledWith(ID, { nameEn: "Food", nameAr: null, tile: 3, color: "ochre" });
});

test("categories_update: unknown id and action errors give fixed sentences", async () => {
  await expect(tool("categories_update").run({ id: "8b6f2c1e-3a4d-4e5f-8a9b-0c1d2e3f4a5b" })).rejects.toBeInstanceOf(ToolError);
  expect(updateCategory).not.toHaveBeenCalled();
  updateCategory.mockResolvedValue({ ok: false, error: "invalid" });
  await expect(tool("categories_update").run({ id: ID })).rejects.toThrow(ACTION_ERROR_TEXT.invalid);
});

test("categories_update input rejects unknown keys and bad values", () => {
  const input = tool("categories_update").input!;
  expect(input.safeParse({ id: ID, tile: 2 }).success).toBe(true);
  expect(input.safeParse({ id: ID, kind: "income" }).success).toBe(false);
  expect(input.safeParse({ id: "x" }).success).toBe(false);
  expect(input.safeParse({ id: ID, tile: 0 }).success).toBe(false);
});

test("categories_delete returns the outcome", async () => {
  removeCategory.mockResolvedValue({ ok: true, outcome: "archived" });
  await expect(tool("categories_delete").run({ id: ID })).resolves.toEqual({ deleted: true, id: ID, outcome: "archived" });
  expect(removeCategory).toHaveBeenCalledWith(ID);
  removeCategory.mockResolvedValue({ ok: false, error: "inUse" });
  await expect(tool("categories_delete").run({ id: ID })).rejects.toThrow(ACTION_ERROR_TEXT.inUse);
  const input = tool("categories_delete").input!;
  expect(input.safeParse({ id: ID, force: true }).success).toBe(false);
  expect(input.safeParse({ id: "bad" }).success).toBe(false);
});

test("categories_restore returns the restored category", async () => {
  restoreCategory.mockResolvedValue({ ok: true });
  await expect(tool("categories_restore").run({ id: ID })).resolves.toEqual({ category: food });
  expect(restoreCategory).toHaveBeenCalledWith(ID);
  restoreCategory.mockResolvedValue({ ok: false, error: "invalid" });
  await expect(tool("categories_restore").run({ id: ID })).rejects.toThrow(ACTION_ERROR_TEXT.invalid);
  expect(tool("categories_restore").input!.safeParse({ id: ID, x: 1 }).success).toBe(false);
});

test("an unknown outcome (failed) is reported with the fixed sentence", async () => {
  restoreCategory.mockResolvedValue({ ok: false, error: "failed" });
  await expect(tool("categories_restore").run({ id: ID })).rejects.toThrow(ACTION_ERROR_TEXT.failed);
});
