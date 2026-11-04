import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ configured: vi.fn(), createClient: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/demo-data", () => ({ DEMO_CATEGORIES: [{ id: "demo", kind: "expense", nameEn: "Demo", nameAr: null, tile: 1, color: "teal", position: 1 }] }));
vi.mock("@/lib/supabase/proxy", () => ({ supabaseConfigured: mock.configured }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mock.createClient }));
import { getCategories } from "./queries";

let query: { select: ReturnType<typeof vi.fn>; order: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  mock.configured.mockReturnValue(true);
  query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis() };
  mock.from.mockReturnValue(query);
  mock.createClient.mockResolvedValue({ from: mock.from });
});

it("loads archived and legacy child categories without active/root filters", async () => {
  query.order.mockReturnValueOnce(query).mockResolvedValueOnce({ data: [{ id: "past", kind: "expense", name_en: "Past", name_ar: null, tile: 2, color: "teal", position: 2, parent_id: "parent", archived_at: "2026-11-04" }], error: null });
  expect(await getCategories()).toEqual([expect.objectContaining({ id: "past", parentId: "parent", archivedAt: "2026-11-04" })]);
  expect(query.order).toHaveBeenNthCalledWith(2, "id");
});
it("throws a safe error rather than treating a failed query as an empty catalogue", async () => {
  query.order.mockReturnValueOnce(query).mockResolvedValueOnce({ data: null, error: { message: "private database details" } });
  await expect(getCategories()).rejects.toThrow("category_catalogue_unavailable");
});
it("provides archive/parent metadata in the read-only demo without fetching", async () => {
  mock.configured.mockReturnValue(false);
  expect(await getCategories()).toEqual([expect.objectContaining({ parentId: null, archivedAt: null })]);
  expect(mock.createClient).not.toHaveBeenCalled();
});
