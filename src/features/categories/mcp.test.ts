import { beforeEach, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getCategories = vi.fn();
vi.mock("./queries", () => ({ getCategories: () => getCategories() }));
import { categoryTools } from "./mcp";

beforeEach(() => getCategories.mockReset());

test("categories_list returns the categories", async () => {
  const categories = [{ id: "c1", kind: "expense", nameEn: "Food", nameAr: "طعام", parentId: null, archivedAt: null }];
  getCategories.mockResolvedValue(categories);
  const [tool] = categoryTools;
  expect(tool.name).toBe("categories_list");
  expect(tool.kind).toBe("read");
  await expect(tool.run({})).resolves.toEqual({ categories });
});
