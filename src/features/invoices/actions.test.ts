import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data?: unknown; error?: { code?: string; message?: string } | null };
const mocks = vi.hoisted(() => ({
  ctx: vi.fn(),
  invalidate: vi.fn(),
  /** Keyed `table.firstMethod` (e.g. `invoice_items.upsert`), falling back to `table`. */
  tables: {} as Record<string, Result>,
  rpcs: {} as Record<string, Result>,
  calls: [] as [string, string, unknown[]][],
  rpcCalls: [] as [string, unknown][],
  /** When set for a key, successive awaits take successive results (then the last one repeats). */
  queues: {} as Record<string, Result[]>,
  create: vi.fn(), remove: vi.fn(),
}));
vi.mock("@/features/profile/queries", () => ({ getProfile: async () => ({ timezone: "Asia/Beirut" }) }));
vi.mock("@/features/transactions/mutations-core", () => ({ createTransactionCore: mocks.create, deleteTransactionCore: mocks.remove }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.invalidate }));
vi.mock("@/lib/supabase/action", async () => ({
  ...(await vi.importActual<typeof import("@/lib/supabase/action")>("@/lib/supabase/action")),
  actionClient: mocks.ctx,
}));
import {
  addItem, createFolder, createOrRotateLink, deleteFolder, deleteItem, joinFolder, setLinkEnabled,
  leaveFolder, removeMember, renameFolder, restoreItem, setMyName, updateItem,
  deleteItems, moveItems, payItems, restoreItems,
} from "./actions";

const uid = (n: number) => `ac000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [folder, item, other, me] = [uid(1), uid(2), uid(3), uid(9)];
const token = "ab".repeat(32);
const ok: Result = { data: null, error: null };

/** Chainable stand-in for a PostgREST query: every method returns itself, awaiting yields the configured result. */
function query(table: string): unknown {
  const self: Record<string, unknown> = {};
  let first: string | null = null;
  for (const method of ["select", "in", "eq", "update", "delete", "upsert", "insert", "maybeSingle"]) {
    self[method] = (...args: unknown[]) => { first ??= method; mocks.calls.push([table, method, args]); return self; };
  }
  self.then = (resolve: (value: Result) => unknown) => {
    const queue = mocks.queues[`${table}.${first}`] ?? mocks.queues[table];
    return resolve((queue && (queue.length > 1 ? queue.shift() : queue[0])) ?? mocks.tables[`${table}.${first}`] ?? mocks.tables[table] ?? ok);
  };
  return self;
}
const rpc = (name: string, args: unknown) => {
  mocks.rpcCalls.push([name, args]);
  const queue = mocks.queues[name];
  return Promise.resolve((queue && (queue.length > 1 ? queue.shift() : queue[0])) ?? mocks.rpcs[name] ?? ok);
};
const called = (table: string, method: string) => mocks.calls.filter(([t, m]) => t === table && m === method);
const rpcCalled = (name: string) => mocks.rpcCalls.filter(([n]) => n === name);

const newItem = { id: item, folderId: folder, categoryId: uid(7), quantity: 1, name: " Cement ", currency: "usd", decimalPlaces: 2, priceMinor: 1500 };
/** The saved row's timestamps as the database reports them (server clock). */
const saved = { id: item, created_at: "2026-11-09T10:00:00.123456+00:00", updated_at: "2026-11-09T10:05:00.654321+00:00" };
const savedTimes = { createdAt: saved.created_at, updatedAt: saved.updated_at };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.rpcCalls.length = 0;
  mocks.tables = {};
  mocks.rpcs = {};
  mocks.queues = {};
  mocks.ctx.mockResolvedValue({ supabase: { from: query, rpc }, userId: me });
});

describe("validation", () => {
  it("rejects invalid input before any database access", async () => {
    const results = await Promise.all([
      createFolder({ id: "x", name: "PC" }),
      createFolder({ id: folder, name: "   " }),
      renameFolder("x", { name: "PC" }),
      renameFolder(folder, { name: "a".repeat(61) }),
      deleteFolder("x"),
      addItem({ ...newItem, priceMinor: 0 }),
      addItem({ ...newItem, name: "" }),
      addItem({ ...newItem, folderId: "x" }),
      updateItem("x", { name: "Cement", quantity: 1, priceMinor: 1 }),
      updateItem(item, { name: "Cement", quantity: 1, priceMinor: 0 }),
      updateItem(item, { name: "Cement", quantity: 1, priceMinor: 1, currency: "USD" }),
      deleteItem("x"),
      restoreItem("x"),
      createOrRotateLink("x"),
      createOrRotateLink(folder, "a".repeat(31)),
      setLinkEnabled("x", false),
      setLinkEnabled(folder, "no" as unknown as boolean),
      joinFolder("short", "Karim"),
      joinFolder(token, "   "),
      joinFolder(token, "a".repeat(31)),
      setMyName("x", "Karim"),
      setMyName(folder, ""),
      removeMember("x", other),
      removeMember(folder, "x"),
      leaveFolder("x"),
    ]);
    for (const result of results) expect(result).toEqual({ ok: false, error: "invalid" });
    expect(mocks.ctx).not.toHaveBeenCalled();
  });
});

describe("preview mode", () => {
  it("every action reports notConfigured without a database", async () => {
    mocks.ctx.mockResolvedValue({ error: "notConfigured" });
    const results = await Promise.all([
      createFolder({ id: folder, name: "PC" }),
      renameFolder(folder, { name: "PC" }),
      deleteFolder(folder),
      addItem(newItem),
      updateItem(item, { name: "Cement", quantity: 1, priceMinor: 1 }),
      deleteItem(item),
      restoreItem(item),
      createOrRotateLink(folder),
      setLinkEnabled(folder, false),
      joinFolder(token, "Karim"),
      setMyName(folder, "Karim"),
      removeMember(folder, other),
      leaveFolder(folder),
    ]);
    for (const result of results) expect(result).toEqual({ ok: false, error: "notConfigured" });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});

describe("folders", () => {
  it("creates idempotently with a client-chosen id", async () => {
    mocks.tables["invoice_folders.upsert"] = { data: [{ id: folder }], error: null };
    expect(await createFolder({ id: folder, name: " PC build " })).toEqual({ ok: true });
    expect(called("invoice_folders", "upsert")[0][2]).toEqual([{ id: folder, name: "PC build" }, { onConflict: "id", ignoreDuplicates: true }]);
    expect(mocks.invalidate).toHaveBeenCalledWith("/", "layout");
  });

  it("counts a retry as success only when the folder is the viewer's own", async () => {
    mocks.tables["invoice_folders.upsert"] = { data: [], error: null };
    mocks.tables["invoice_folders.select"] = { data: { id: folder }, error: null };
    expect(await createFolder({ id: folder, name: "PC" })).toEqual({ ok: true });
    expect(called("invoice_folders", "eq").map(([, , a]) => a)).toContainEqual(["owner_id", me]);
    mocks.tables["invoice_folders.select"] = { data: null, error: null };
    expect(await createFolder({ id: folder, name: "PC" })).toEqual({ ok: false, error: "conflict" });
  });

  it("treats the folder cap on a retry of an existing folder as success, otherwise as limitReached", async () => {
    mocks.tables["invoice_folders.upsert"] = { data: null, error: { message: "invoices.limit" } };
    mocks.tables["invoice_folders.select"] = { data: { id: folder }, error: null };
    expect(await createFolder({ id: folder, name: "PC" })).toEqual({ ok: true });
    mocks.tables["invoice_folders.select"] = { data: null, error: null };
    expect(await createFolder({ id: folder, name: "PC" })).toEqual({ ok: false, error: "limitReached" });
  });

  it("renames; a folder that is gone or not the viewer's is a conflict", async () => {
    mocks.tables["invoice_folders.update"] = { data: [{ id: folder }], error: null };
    expect(await renameFolder(folder, { name: " Garage " })).toEqual({ ok: true });
    expect(called("invoice_folders", "update")[0][2]).toEqual([{ name: "Garage" }]);
    mocks.tables["invoice_folders.update"] = { data: [], error: null };
    expect(await renameFolder(folder, { name: "Garage" })).toEqual({ ok: false, error: "conflict" });
  });

  it("deletes; a repeat is fine but a folder the viewer cannot delete is a conflict", async () => {
    mocks.tables["invoice_folders.delete"] = { data: [{ id: folder }], error: null };
    expect(await deleteFolder(folder)).toEqual({ ok: true });
    mocks.tables["invoice_folders.delete"] = { data: [], error: null };
    mocks.tables["invoice_folders.select"] = { data: null, error: null };
    expect(await deleteFolder(folder)).toEqual({ ok: true });
    mocks.tables["invoice_folders.select"] = { data: { id: folder }, error: null };
    expect(await deleteFolder(folder)).toEqual({ ok: false, error: "conflict" });
  });

  it("does not revalidate: that would re-render the open folder page, which redirects to the unavailable notice", async () => {
    mocks.tables["invoice_folders.delete"] = { data: [{ id: folder }], error: null };
    expect(await deleteFolder(folder)).toEqual({ ok: true });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});

describe("addItem", () => {
  it("upserts with the client id so a retried id is a no-op, and returns the server's timestamps", async () => {
    mocks.tables["invoice_items.upsert"] = { data: [saved], error: null };
    expect(await addItem(newItem)).toEqual({ ok: true, ...savedTimes });
    expect(called("invoice_items", "upsert")[0][2]).toEqual([
      { id: item, folder_id: folder, category_id: uid(7), name: "Cement", currency: "USD", decimal_places: 2, price_minor: 1500, quantity: 1 },
      { onConflict: "id", ignoreDuplicates: true },
    ]);
    expect(called("invoice_items", "select")).toHaveLength(1);
    expect(called("invoice_items", "select")[0][2]).toEqual(["id,created_at,updated_at"]);
    expect(mocks.invalidate).toHaveBeenCalledWith("/", "layout");
  });

  it("a saved row without readable timestamps is reported as failed, never stamped by this server's clock", async () => {
    mocks.tables["invoice_items.upsert"] = { data: [{ id: item }], error: null };
    expect(await addItem(newItem)).toEqual({ ok: false, error: "failed" });
    mocks.tables["invoice_items.upsert"] = { data: [{ ...saved, updated_at: "yesterday" }], error: null };
    expect(await addItem(newItem)).toEqual({ ok: false, error: "failed" });
  });

  it("forwards the currency units the form was built with", async () => {
    const expectedUnits = { USD: 2 };
    await addItem({ ...newItem, expectedUnits });
    expect(mocks.ctx).toHaveBeenCalledWith(expectedUnits);
  });

  it("counts an ignored duplicate as success only when the row is visible in the same folder", async () => {
    mocks.tables["invoice_items.upsert"] = { data: [], error: null };
    mocks.tables["invoice_items.select"] = { data: saved, error: null };
    expect(await addItem(newItem)).toEqual({ ok: true, ...savedTimes });
    expect(called("invoice_items", "eq").map(([, , a]) => a)).toContainEqual(["folder_id", folder]);
    expect(called("invoice_items", "select").at(-1)![2]).toEqual(["id,created_at,updated_at"]);
    mocks.tables["invoice_items.select"] = { data: null, error: null };
    expect(await addItem(newItem)).toEqual({ ok: false, error: "conflict" });
  });

  it("handles a reported duplicate-key error the same way", async () => {
    mocks.tables["invoice_items.upsert"] = { data: null, error: { code: "23505", message: "duplicate key" } };
    mocks.tables["invoice_items.select"] = { data: saved, error: null };
    expect(await addItem(newItem)).toEqual({ ok: true, ...savedTimes });
    mocks.tables["invoice_items.select"] = { data: null, error: null };
    expect(await addItem(newItem)).toEqual({ ok: false, error: "conflict" });
  });

  it("maps the row cap, a vanished folder and a missing currency; a retry at the cap still succeeds", async () => {
    mocks.tables["invoice_items.upsert"] = { data: null, error: { message: "invoices.limit" } };
    mocks.tables["invoice_items.select"] = { data: null, error: null };
    expect(await addItem(newItem)).toEqual({ ok: false, error: "limitReached" });
    mocks.tables["invoice_items.select"] = { data: saved, error: null };
    expect(await addItem(newItem)).toEqual({ ok: true, ...savedTimes });
    mocks.tables["invoice_items.upsert"] = { data: null, error: { code: "42501", message: "invoices.invalid" } };
    expect(await addItem(newItem)).toEqual({ ok: false, error: "conflict" });
  });

  it("tells a rejected currency (P0001) from a vanished folder (42501) and keeps the duplicate/cap logic", async () => {
    mocks.tables["invoice_items.upsert"] = { data: null, error: { code: "P0001", message: "invoices.invalid" } };
    expect(await addItem(newItem)).toEqual({ ok: false, error: "currencyUnavailable" });
    mocks.tables["invoice_items.upsert"] = { data: null, error: { code: "42501", message: "invoices.invalid" } };
    expect(await addItem(newItem)).toEqual({ ok: false, error: "conflict" });
    // Other P0001 messages are not the currency rule.
    mocks.tables["invoice_items.upsert"] = { data: null, error: { code: "P0001", message: "invoices.limit" } };
    mocks.tables["invoice_items.select"] = { data: null, error: null };
    expect(await addItem(newItem)).toEqual({ ok: false, error: "limitReached" });
    mocks.tables["invoice_items.upsert"] = { data: null, error: { code: "23505", message: "duplicate key" } };
    mocks.tables["invoice_items.select"] = { data: saved, error: null };
    expect(await addItem(newItem)).toEqual({ ok: true, ...savedTimes });
  });

  it("never leaks unknown database messages", async () => {
    mocks.tables["invoice_items.upsert"] = { data: null, error: { message: "relation x does not exist" } };
    expect(await addItem(newItem)).toEqual({ ok: false, error: "failed" });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});

describe("updateItem and deleteItem", () => {
  it("edits name and price, adding currency and decimals only when both are given, and returns the server's timestamps", async () => {
    mocks.tables["invoice_items.update"] = { data: [saved], error: null };
    expect(await updateItem(item, { name: " Cement ", priceMinor: 1600, quantity: 1 })).toEqual({ ok: true, ...savedTimes });
    expect(called("invoice_items", "update")[0][2]).toEqual([{ name: "Cement", price_minor: 1600, quantity: 1 }]);
    expect(called("invoice_items", "select")[0][2]).toEqual(["id,created_at,updated_at"]);
    expect(await updateItem(item, { name: "Cement", quantity: 1, priceMinor: 1600, currency: "lbp", decimalPlaces: 0 })).toEqual({ ok: true, ...savedTimes });
    expect(called("invoice_items", "update")[1][2]).toEqual([{ name: "Cement", price_minor: 1600, quantity: 1, currency: "LBP", decimal_places: 0 }]);
  });

  it("an updated row without readable timestamps is reported as failed", async () => {
    mocks.tables["invoice_items.update"] = { data: [{ id: item }], error: null };
    expect(await updateItem(item, { name: "Cement", quantity: 1, priceMinor: 1 })).toEqual({ ok: false, error: "failed" });
  });

  it("reports a row that no longer exists as a conflict, not an error", async () => {
    mocks.tables["invoice_items.update"] = { data: [], error: null };
    expect(await updateItem(item, { name: "Cement", quantity: 1, priceMinor: 1 })).toEqual({ ok: false, error: "conflict" });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("an edit rejected by the currency rule (P0001) is currencyUnavailable, a lost membership (42501) a conflict", async () => {
    mocks.tables["invoice_items.update"] = { data: null, error: { code: "P0001", message: "invoices.invalid" } };
    expect(await updateItem(item, { name: "Cement", quantity: 1, priceMinor: 1, currency: "EUR", decimalPlaces: 2 })).toEqual({ ok: false, error: "currencyUnavailable" });
    mocks.tables["invoice_items.update"] = { data: null, error: { code: "42501", message: "invoices.invalid" } };
    expect(await updateItem(item, { name: "Cement", quantity: 1, priceMinor: 1 })).toEqual({ ok: false, error: "conflict" });
  });

  it("maps database rules", async () => {
    mocks.tables["invoice_items.update"] = { data: null, error: { message: "invoices.invalid" } };
    expect(await updateItem(item, { name: "Cement", quantity: 1, priceMinor: 1, currency: "EUR", decimalPlaces: 2 })).toEqual({ ok: false, error: "conflict" });
    mocks.tables["invoice_items.update"] = { data: null, error: { message: "internal details" } };
    expect(await updateItem(item, { name: "Cement", quantity: 1, priceMinor: 1 })).toEqual({ ok: false, error: "failed" });
  });

  it("deletes, and a row already gone is fine", async () => {
    mocks.tables["invoice_items.delete"] = { data: [], error: null };
    expect(await deleteItem(item)).toEqual({ ok: true });
    expect(called("invoice_items", "delete")).toHaveLength(1);
    expect(mocks.invalidate).toHaveBeenCalledWith("/", "layout");
    mocks.tables["invoice_items.delete"] = { data: null, error: { message: "internal details" } };
    expect(await deleteItem(item)).toEqual({ ok: false, error: "failed" });
  });
});

describe("restoreItem", () => {
  it("calls restore_invoice_item with the item id and answers with the row's server timestamps", async () => {
    mocks.tables["invoice_items.select"] = { data: saved, error: null };
    expect(await restoreItem(item)).toEqual({ ok: true, ...savedTimes });
    expect(rpcCalled("restore_invoice_item")).toEqual([["restore_invoice_item", { p_item: item }]]);
    expect(called("invoice_items", "select")[0][2]).toEqual(["id,created_at,updated_at"]);
    expect(called("invoice_items", "eq").map(([, , a]) => a)).toContainEqual(["id", item]);
    expect(mocks.invalidate).toHaveBeenCalledWith("/", "layout");
  });

  it("a restored row whose timestamps cannot be read back is reported as failed, never stamped by this server's clock", async () => {
    mocks.tables["invoice_items.select"] = { data: { id: item }, error: null };
    expect(await restoreItem(item)).toEqual({ ok: false, error: "failed" });
    mocks.tables["invoice_items.select"] = { data: null, error: { message: "boom" } };
    expect(await restoreItem(item)).toEqual({ ok: false, error: "failed" });
  });

  it("reports an expired or taken restore as a conflict and a full folder as limitReached", async () => {
    mocks.rpcs.restore_invoice_item = { data: null, error: { code: "P0001", message: "invoices.invalid" } };
    expect(await restoreItem(item)).toEqual({ ok: false, error: "conflict" });
    mocks.rpcs.restore_invoice_item = { data: null, error: { code: "P0001", message: "invoices.limit" } };
    expect(await restoreItem(item)).toEqual({ ok: false, error: "limitReached" });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});

describe("sharing", () => {
  it("creates or rotates the link, passing the owner's name", async () => {
    mocks.rpcs.rotate_invoice_link = { data: token, error: null };
    expect(await createOrRotateLink(folder, " Sam ")).toEqual({ ok: true, token });
    expect(rpcCalled("rotate_invoice_link")[0][1]).toEqual({ p_folder: folder, p_owner_name: "Sam" });
    expect(await createOrRotateLink(folder)).toEqual({ ok: true, token });
    expect(rpcCalled("rotate_invoice_link")[1][1]).toEqual({ p_folder: folder, p_owner_name: null });
    expect(mocks.invalidate).toHaveBeenCalledWith("/", "layout");
  });

  it("fails cleanly when the owner's name is still needed, or the token is malformed", async () => {
    mocks.rpcs.rotate_invoice_link = { data: null, error: { message: "invoices.invalid" } };
    expect(await createOrRotateLink(folder)).toEqual({ ok: false, error: "conflict" });
    mocks.rpcs.rotate_invoice_link = { data: "not a token", error: null };
    expect(await createOrRotateLink(folder, "Sam")).toEqual({ ok: false, error: "failed" });
  });

  it("switches joining off and on again without touching the link", async () => {
    expect(await setLinkEnabled(folder, false)).toEqual({ ok: true });
    expect(await setLinkEnabled(folder, true)).toEqual({ ok: true });
    expect(rpcCalled("set_invoice_link_enabled")).toEqual([
      ["set_invoice_link_enabled", { p_folder: folder, p_enabled: false }],
      ["set_invoice_link_enabled", { p_folder: folder, p_enabled: true }],
    ]);
  });

  it("joins through the RPC exactly once and returns the folder id", async () => {
    mocks.rpcs.join_invoice_folder = { data: folder, error: null };
    expect(await joinFolder(token, " Karim ")).toEqual({ ok: true, folderId: folder });
    expect(rpcCalled("join_invoice_folder")).toEqual([["join_invoice_folder", { p_token: token, p_name: "Karim" }]]);
    expect(mocks.invalidate).toHaveBeenCalledWith("/", "layout");
  });

  it("maps a link that does not work, including a full folder, to the same linkInvalid", async () => {
    mocks.rpcs.join_invoice_folder = { data: null, error: { code: "P0001", message: "invoices.link" } };
    expect(await joinFolder(token, "Karim")).toEqual({ ok: false, error: "linkInvalid" });
    // A full folder must look like any other dead link, so the page never reveals that the folder exists.
    mocks.rpcs.join_invoice_folder = { data: null, error: { code: "P0001", message: "invoices.full" } };
    expect(await joinFolder(token, "Karim")).toEqual({ ok: false, error: "linkInvalid" });
    mocks.rpcs.join_invoice_folder = { data: "nope", error: null };
    expect(await joinFolder(token, "Karim")).toEqual({ ok: false, error: "failed" });
    expect(rpcCalled("join_invoice_folder")).toHaveLength(3);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("renames the viewer in one folder only", async () => {
    mocks.tables["invoice_members.update"] = { data: [{ user_id: me }], error: null };
    expect(await setMyName(folder, " Kay ")).toEqual({ ok: true });
    expect(called("invoice_members", "update")[0][2]).toEqual([{ display_name: "Kay" }]);
    const filters = called("invoice_members", "eq").map(([, , a]) => a);
    expect(filters).toContainEqual(["folder_id", folder]);
    expect(filters).toContainEqual(["user_id", me]);
    mocks.tables["invoice_members.update"] = { data: [], error: null };
    expect(await setMyName(folder, "Kay")).toEqual({ ok: false, error: "conflict" });
  });

  it("removes a member and leaves through the RPCs", async () => {
    expect(await removeMember(folder, other)).toEqual({ ok: true });
    expect(rpcCalled("remove_invoice_member")).toEqual([["remove_invoice_member", { p_folder: folder, p_user: other }]]);
    expect(await leaveFolder(folder)).toEqual({ ok: true });
    expect(rpcCalled("leave_invoice_folder")).toEqual([["leave_invoice_folder", { p_folder: folder }]]);
    mocks.rpcs.remove_invoice_member = { data: null, error: { message: "invoices.invalid" } };
    expect(await removeMember(folder, other)).toEqual({ ok: false, error: "conflict" });
  });

  it("leaving does not revalidate: the open folder page would redirect to the lost-access notice", async () => {
    expect(await leaveFolder(folder)).toEqual({ ok: true });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("returns failed when the call throws", async () => {
    mocks.ctx.mockRejectedValue(new Error("boom"));
    expect(await leaveFolder(folder)).toEqual({ ok: false, error: "failed" });
  });
});

describe("bulk actions", () => {
  const ids = [item, other];

  it("validate before any database access", async () => {
    const results = await Promise.all([
      deleteItems({ folderId: folder, itemIds: [] }),
      deleteItems({ folderId: "x", itemIds: ids }),
      deleteItems({ folderId: folder, itemIds: [item, item] }),
      moveItems({ folderId: folder, itemIds: ids, categoryId: "x" }),
      restoreItems({ itemIds: [] }),
    ]);
    for (const result of results) expect(result).toEqual({ ok: false, error: "invalid" });
    expect(mocks.ctx).not.toHaveBeenCalled();
  });

  it("deletes the whole batch in one call and reports the rows it removed", async () => {
    mocks.rpcs.delete_invoice_items = { data: [item], error: null };
    // The other row was already gone (someone else deleted it): still a success.
    expect(await deleteItems({ folderId: folder, itemIds: ids })).toEqual({ ok: true, deleted: [item] });
    expect(mocks.rpcCalls).toEqual([["delete_invoice_items", { p_folder: folder, p_items: ids }]]);
    expect(mocks.calls).toEqual([]);
    expect(mocks.invalidate).toHaveBeenCalledWith("/", "layout");
  });

  it("moves the whole batch in one call and answers with the rows that still exist", async () => {
    mocks.rpcs.move_invoice_items = { data: [{ id: item, updated_at: saved.updated_at }], error: null };
    expect(await moveItems({ folderId: folder, itemIds: ids, categoryId: uid(7) })).toEqual({ ok: true, rows: [{ id: item, updatedAt: saved.updated_at }] });
    expect(mocks.rpcCalls).toEqual([["move_invoice_items", { p_folder: folder, p_items: ids, p_category: uid(7) }]]);
    // A category someone deleted meanwhile.
    mocks.rpcs.move_invoice_items = { data: null, error: { code: "23503", message: "invoices.category" } };
    expect(await moveItems({ folderId: folder, itemIds: ids, categoryId: uid(7) })).toEqual({ ok: false, error: "conflict" });
  });

  it("restores a batch all or nothing", async () => {
    mocks.rpcs.restore_invoice_items = { data: ids.map((id) => ({ ...saved, id })), error: null };
    expect(await restoreItems({ itemIds: ids })).toEqual({ ok: true, rows: ids.map((id) => ({ id, ...savedTimes })) });
    expect(mocks.rpcCalls).toEqual([["restore_invoice_items", { p_items: ids }]]);
    mocks.rpcs.restore_invoice_items = { data: null, error: { message: "invoices.invalid" } };
    expect(await restoreItems({ itemIds: ids })).toEqual({ ok: false, error: "conflict" });
    // Fewer rows back than asked for is not a success.
    mocks.rpcs.restore_invoice_items = { data: [{ ...saved, id: item }], error: null };
    expect(await restoreItems({ itemIds: ids })).toEqual({ ok: false, error: "failed" });
  });

  it("editing a paid row reports that it is paid, not that it was removed", async () => {
    mocks.tables["invoice_items.update"] = { data: null, error: { code: "P0001", message: "invoices.paid" } };
    expect(await updateItem(item, { name: "Cement", quantity: 1, priceMinor: 1 })).toEqual({ ok: false, error: "paymentChanged" });
  });
});

describe("payItems", () => {
  const [cpu, fans, cables, request, request2, balance, balance2, category] = [uid(11), uid(12), uid(13), uid(21), uid(22), uid(31), uid(32), uid(41)];
  const line = (id: string, name: string, price: number, quantity = 1, extra: Record<string, unknown> = {}) =>
    ({ id, name, currency: "USD", decimal_places: 2, price_minor: price, quantity, created_at: `2026-11-0${id === cpu ? 1 : 2}T00:00:00Z`, paid_on: null, paid_transaction_id: null, ...extra });
  const marked = (id: string) => ({ id, updated_at: saved.updated_at, paid_on: "2026-01-01", paid_at: saved.updated_at });
  const paidRow = (id: string) => ({ id, updatedAt: saved.updated_at, paidOn: "2026-01-01", paidAt: saved.updated_at });
  const input = { expectedUnits: { USD: 2 }, folderId: folder, categoryId: category, occurredOn: "2026-01-01", payments: [{ requestId: request, balanceId: balance, itemIds: [cpu, fans] }] };

  beforeEach(() => {
    mocks.create.mockReset().mockImplementation(async (_input: unknown, id: string) => ({ ok: true, id, revision: 1 }));
    mocks.remove.mockReset().mockResolvedValue({ ok: true, id: request, revision: 2 });
    mocks.tables = {
      "invoice_items.select": { data: [line(fans, "Fans", 1500, 3), line(cpu, "CPU", 25_000)], error: null },
      wallet_balances: { data: { currency: "USD" }, error: null },
      transactions: { data: null, error: null },
    };
    mocks.rpcs.mark_invoice_items_paid = { data: [marked(cpu), marked(fans)], error: null };
  });

  it("validates before any database access", async () => {
    expect(await payItems({ ...input, payments: [] })).toEqual({ ok: false, error: "invalid" });
    expect(await payItems({ ...input, payments: [{ ...input.payments[0], itemIds: [cpu, cpu] }] })).toEqual({ ok: false, error: "invalid" });
    expect(await payItems({ ...input, occurredOn: "2099-01-01" })).toEqual({ ok: false, error: "invalid" });
    expect(mocks.ctx).not.toHaveBeenCalled();
  });

  it("records one expense for price x quantity, itemised by name, then marks the rows paid", async () => {
    expect(await payItems(input)).toEqual({ ok: true, payments: [{ id: request, revision: 1 }], rows: [paidRow(cpu), paidRow(fans)] });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      kind: "expense", occurredOn: "2026-01-01", amountMinor: 29_500, balanceId: balance, categoryId: category, expectedUnits: { USD: 2 }, note: "CPU, Fans × 3",
      items: [{ description: "CPU", amountMinor: 25_000 }, { description: "Fans × 3", amountMinor: 4500 }],
    }), request);
    expect(rpcCalled("mark_invoice_items_paid")).toEqual([["mark_invoice_items_paid", { p_folder: folder, p_items: [cpu, fans], p_transaction: request }]]);
    // The rows are read from this folder only.
    expect(called("invoice_items", "eq")[0][2]).toEqual(["folder_id", folder]);
    expect(mocks.invalidate).toHaveBeenCalledWith("/", "layout");
  });

  it("uses the row as the note and no breakdown for a single row", async () => {
    mocks.tables["invoice_items.select"] = { data: [line(fans, "Fans", 1500, 3)], error: null };
    mocks.rpcs.mark_invoice_items_paid = { data: [marked(fans)], error: null };
    expect(await payItems({ ...input, payments: [{ ...input.payments[0], itemIds: [fans] }] })).toMatchObject({ ok: true });
    const [sent] = mocks.create.mock.calls[0];
    expect(sent).toMatchObject({ amountMinor: 4500, note: "Fans × 3" });
    expect(sent).not.toHaveProperty("items");
  });

  it("shortens a long product name to what an expense line can hold", async () => {
    mocks.tables["invoice_items.select"] = { data: [line(cpu, "x".repeat(200), 100, 12), line(fans, "Fans", 100)], error: null };
    await payItems(input);
    const [sent] = mocks.create.mock.calls[0];
    expect(Array.from(sent.items[0].description as string)).toHaveLength(140);
    // The name gives way, never the quantity.
    expect(sent.items[0].description.endsWith("… × 12")).toBe(true);
    expect(Array.from(sent.note as string).length).toBeLessThanOrEqual(140);
  });

  it("pays two currencies as two expenses, each from its own balance, never one combined amount", async () => {
    mocks.queues["invoice_items.select"] = [
      { data: [line(cpu, "CPU", 25_000)], error: null },
      { data: [line(cables, "Cables", 900_000, 1, { currency: "LBP", decimal_places: 0 })], error: null },
    ];
    mocks.queues.wallet_balances = [{ data: { currency: "USD" }, error: null }, { data: { currency: "LBP" }, error: null }];
    mocks.queues.mark_invoice_items_paid = [{ data: [marked(cpu)], error: null }, { data: [marked(cables)], error: null }];
    const both = { ...input, expectedUnits: { USD: 2, LBP: 0 }, payments: [
      { requestId: request, balanceId: balance, itemIds: [cpu] }, { requestId: request2, balanceId: balance2, itemIds: [cables] },
    ] };
    expect(await payItems(both)).toEqual({ ok: true, payments: [{ id: request, revision: 1 }, { id: request2, revision: 1 }], rows: [paidRow(cpu), paidRow(cables)] });
    expect(mocks.create.mock.calls.map(([sent, id]) => [id, sent.amountMinor, sent.balanceId])).toEqual([[request, 25_000, balance], [request2, 900_000, balance2]]);
  });

  it("records nothing at all when any currency's rows do not check out", async () => {
    mocks.queues["invoice_items.select"] = [
      { data: [line(cpu, "CPU", 25_000)], error: null },
      { data: [], error: null },
    ];
    const both = { ...input, expectedUnits: { USD: 2, LBP: 0 }, payments: [
      { requestId: request, balanceId: balance, itemIds: [cpu] }, { requestId: request2, balanceId: balance2, itemIds: [cables] },
    ] };
    expect(await payItems(both)).toEqual({ ok: false, error: "conflict" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.rpcCalls).toEqual([]);
  });

  it("refuses rows that changed, mixed currencies, other decimals, a paid row and a wallet in another currency", async () => {
    mocks.tables["invoice_items.select"] = { data: [line(cpu, "CPU", 25_000)], error: null };
    expect(await payItems(input)).toEqual({ ok: false, error: "conflict" });
    mocks.tables["invoice_items.select"] = { data: [line(cpu, "CPU", 25_000), line(fans, "Fans", 1500, 1, { currency: "LBP", decimal_places: 0 })], error: null };
    expect(await payItems(input)).toEqual({ ok: false, error: "invalid" });
    mocks.tables["invoice_items.select"] = { data: [line(cpu, "CPU", 25_000, 1, { decimal_places: 3 }), line(fans, "Fans", 1500, 1, { decimal_places: 3 })], error: null };
    expect(await payItems(input)).toEqual({ ok: false, error: "currencyUnavailable" });
    mocks.tables["invoice_items.select"] = { data: [line(cpu, "CPU", 25_000, 1, { paid_on: "2026-01-01", paid_transaction_id: uid(99) }), line(fans, "Fans", 1500)], error: null };
    expect(await payItems(input)).toEqual({ ok: false, error: "paymentChanged" });
    mocks.tables["invoice_items.select"] = { data: [line(cpu, "CPU", 25_000), line(fans, "Fans", 1500)], error: null };
    mocks.tables.wallet_balances = { data: { currency: "LBP" }, error: null };
    expect(await payItems(input)).toEqual({ ok: false, error: "walletUnavailable" });
    mocks.tables.wallet_balances = { data: null, error: null };
    expect(await payItems(input)).toEqual({ ok: false, error: "walletUnavailable" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("completes a retry without recording the expense twice", async () => {
    mocks.tables.transactions = { data: { id: request, revision: 1, kind: "expense", amount_minor: 29_500, deleted_at: null }, error: null };
    mocks.tables["invoice_items.select"] = { data: [line(cpu, "CPU", 25_000, 1, { paid_on: "2026-01-01", paid_transaction_id: request }), line(fans, "Fans", 1500, 3)], error: null };
    expect(await payItems(input)).toMatchObject({ ok: true, payments: [{ id: request, revision: 1 }] });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(rpcCalled("mark_invoice_items_paid")).toHaveLength(1);
  });

  it("refuses a request id that already belongs to a different or deleted expense", async () => {
    mocks.tables.transactions = { data: { id: request, revision: 1, kind: "expense", amount_minor: 1, deleted_at: null }, error: null };
    expect(await payItems(input)).toEqual({ ok: false, error: "conflict" });
    mocks.tables.transactions = { data: { id: request, revision: 2, kind: "expense", amount_minor: 29_500, deleted_at: "2026-01-02" }, error: null };
    expect(await payItems(input)).toEqual({ ok: false, error: "conflict" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("passes on the transaction core's refusal without marking anything", async () => {
    mocks.create.mockResolvedValue({ ok: false, error: "categoryUnavailable" });
    expect(await payItems(input)).toEqual({ ok: false, error: "categoryUnavailable" });
    expect(mocks.rpcCalls).toEqual([]);
  });

  it("takes the expense back out when the rows can no longer be linked", async () => {
    // Someone paid one of the rows between the check and the link.
    mocks.rpcs.mark_invoice_items_paid = { data: null, error: { code: "P0001", message: "invoices.paid" } };
    expect(await payItems(input)).toEqual({ ok: false, error: "paymentChanged" });
    expect(mocks.remove).toHaveBeenCalledWith(request, 1);
    // A row deleted meanwhile.
    mocks.remove.mockClear();
    mocks.rpcs.mark_invoice_items_paid = { data: null, error: { code: "42501", message: "invoices.invalid" } };
    expect(await payItems(input)).toEqual({ ok: false, error: "conflict" });
    expect(mocks.remove).toHaveBeenCalledWith(request, 1);
    // The take-back itself failed: retryable, and the same request tries again.
    mocks.remove.mockResolvedValue({ ok: false, error: "failed" });
    expect(await payItems(input)).toEqual({ ok: false, error: "failed" });
  });

  it("keeps the expense and reports a retryable failure when the link's outcome is unknown", async () => {
    mocks.rpcs.mark_invoice_items_paid = { data: null, error: { message: "connection reset" } };
    expect(await payItems(input)).toEqual({ ok: false, error: "failed" });
    expect(mocks.remove).not.toHaveBeenCalled();
    mocks.rpcs.mark_invoice_items_paid = { data: [marked(cpu)], error: null };
    expect(await payItems(input)).toEqual({ ok: false, error: "failed" });
  });

  it("reports notConfigured without a database", async () => {
    mocks.ctx.mockResolvedValue({ error: "notConfigured" });
    expect(await payItems(input)).toEqual({ ok: false, error: "notConfigured" });
  });
});
