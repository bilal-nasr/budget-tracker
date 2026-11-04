import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ actionClient: vi.fn(), revalidatePath: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/action", () => ({ actionClient: mock.actionClient }));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidatePath }));
import { createCategory, removeCategory, restoreCategory, updateCategory } from "./actions";

const id = "aaaaaaaa-0000-4000-8000-000000000001";
const input = { kind: "expense" as const, nameEn: "Food", nameAr: null, tile: 1 as const, color: "teal" as const };
const edit = { nameEn: "Food", nameAr: null, tile: 1 as const, color: "teal" as const };
let query: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  query = Object.fromEntries(["select", "eq", "is", "not", "order", "limit", "insert", "update"].map((key) => [key, vi.fn().mockReturnThis()]));
  query.maybeSingle = vi.fn().mockResolvedValue({ data: { id, position: 12 }, error: null });
  query.single = vi.fn().mockResolvedValue({ data: { id }, error: null });
  mock.from.mockReturnValue(query);
  mock.actionClient.mockResolvedValue({ supabase: { from: mock.from, rpc: mock.rpc }, userId: id });
});

describe("category mutations", () => {
  it("rejects forged fields and invalid UUIDs before creating a client", async () => {
    expect(await createCategory({ ...input, userId: id } as typeof input)).toEqual({ ok: false, error: "invalid" });
    expect(await updateCategory("invalid", edit)).toEqual({ ok: false, error: "invalid" });
    expect(await removeCategory("invalid")).toEqual({ ok: false, error: "invalid" });
    expect(await restoreCategory("invalid")).toEqual({ ok: false, error: "invalid" });
    expect(mock.actionClient).not.toHaveBeenCalled();
  });
  it("returns preview/session errors without mutating or revalidating", async () => {
    mock.actionClient.mockResolvedValue({ error: "notConfigured" });
    expect(await createCategory(input)).toEqual({ ok: false, error: "notConfigured" });
    expect(await removeCategory(id)).toEqual({ ok: false, error: "notConfigured" });
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.revalidatePath).not.toHaveBeenCalled();
  });
  it("creates normalized owner-scoped roots after the current position", async () => {
    expect(await createCategory({ ...input, nameEn: "  Food\t shop " })).toEqual({ ok: true, id });
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: id, parent_id: null, name_en: "Food shop", position: 13 }));
    expect(mock.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("does not report a nonexistent/foreign update as success", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await updateCategory(id, edit)).toEqual({ ok: false, error: "invalid" });
    expect(query.eq).toHaveBeenCalledWith("user_id", id);
    expect(query.is).toHaveBeenCalledWith("archived_at", null);
    expect(mock.revalidatePath).not.toHaveBeenCalled();
  });
  it("maps duplicate names and restores only owned archived categories", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: { code: "23505" } });
    expect(await restoreCategory(id)).toEqual({ ok: false, error: "duplicateName" });
    expect(query.eq).toHaveBeenCalledWith("user_id", id);
    expect(query.not).toHaveBeenCalledWith("archived_at", "is", null);
  });
  it("delegates removal atomically and validates the returned outcome", async () => {
    mock.rpc.mockResolvedValue({ data: "archived", error: null });
    expect(await removeCategory(id)).toEqual({ ok: true, outcome: "archived" });
    expect(mock.rpc).toHaveBeenCalledWith("remove_category", { p_id: id });
    mock.rpc.mockResolvedValue({ data: "deleted", error: null });
    expect(await removeCategory(id)).toEqual({ ok: true, outcome: "deleted" });
    mock.rpc.mockResolvedValue({ data: null, error: null });
    expect(await removeCategory(id)).toEqual({ ok: false, error: "failed" });
  });
  it("maps dependency/foreign failures without exposing database details", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "category_in_use" } });
    expect(await removeCategory(id)).toEqual({ ok: false, error: "inUse" });
    mock.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "category_not_found" } });
    expect(await removeCategory(id)).toEqual({ ok: false, error: "invalid" });
    expect(mock.revalidatePath).not.toHaveBeenCalled();
  });
});
