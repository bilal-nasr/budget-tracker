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
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.invalidate }));
vi.mock("@/lib/supabase/action", async () => ({
  ...(await vi.importActual<typeof import("@/lib/supabase/action")>("@/lib/supabase/action")),
  actionClient: mocks.ctx,
}));
import {
  addItem, createFolder, createOrRotateLink, deleteFolder, deleteItem, disableLink, joinFolder,
  leaveFolder, removeMember, renameFolder, restoreItem, setMyName, updateItem,
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
  self.then = (resolve: (value: Result) => unknown) => resolve(mocks.tables[`${table}.${first}`] ?? mocks.tables[table] ?? ok);
  return self;
}
const rpc = (name: string, args: unknown) => {
  mocks.rpcCalls.push([name, args]);
  return Promise.resolve(mocks.rpcs[name] ?? ok);
};
const called = (table: string, method: string) => mocks.calls.filter(([t, m]) => t === table && m === method);
const rpcCalled = (name: string) => mocks.rpcCalls.filter(([n]) => n === name);

const newItem = { id: item, folderId: folder, name: " Cement ", currency: "usd", decimalPlaces: 2, priceMinor: 1500 };
/** The saved row's timestamps as the database reports them (server clock). */
const saved = { id: item, created_at: "2026-11-09T10:00:00.123456+00:00", updated_at: "2026-11-09T10:05:00.654321+00:00" };
const savedTimes = { createdAt: saved.created_at, updatedAt: saved.updated_at };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.rpcCalls.length = 0;
  mocks.tables = {};
  mocks.rpcs = {};
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
      updateItem("x", { name: "Cement", priceMinor: 1 }),
      updateItem(item, { name: "Cement", priceMinor: 0 }),
      updateItem(item, { name: "Cement", priceMinor: 1, currency: "USD" }),
      deleteItem("x"),
      restoreItem("x"),
      createOrRotateLink("x"),
      createOrRotateLink(folder, "a".repeat(31)),
      disableLink("x"),
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
      updateItem(item, { name: "Cement", priceMinor: 1 }),
      deleteItem(item),
      restoreItem(item),
      createOrRotateLink(folder),
      disableLink(folder),
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
      { id: item, folder_id: folder, name: "Cement", currency: "USD", decimal_places: 2, price_minor: 1500 },
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
    expect(await updateItem(item, { name: " Cement ", priceMinor: 1600 })).toEqual({ ok: true, ...savedTimes });
    expect(called("invoice_items", "update")[0][2]).toEqual([{ name: "Cement", price_minor: 1600 }]);
    expect(called("invoice_items", "select")[0][2]).toEqual(["id,created_at,updated_at"]);
    expect(await updateItem(item, { name: "Cement", priceMinor: 1600, currency: "lbp", decimalPlaces: 0 })).toEqual({ ok: true, ...savedTimes });
    expect(called("invoice_items", "update")[1][2]).toEqual([{ name: "Cement", price_minor: 1600, currency: "LBP", decimal_places: 0 }]);
  });

  it("an updated row without readable timestamps is reported as failed", async () => {
    mocks.tables["invoice_items.update"] = { data: [{ id: item }], error: null };
    expect(await updateItem(item, { name: "Cement", priceMinor: 1 })).toEqual({ ok: false, error: "failed" });
  });

  it("reports a row that no longer exists as a conflict, not an error", async () => {
    mocks.tables["invoice_items.update"] = { data: [], error: null };
    expect(await updateItem(item, { name: "Cement", priceMinor: 1 })).toEqual({ ok: false, error: "conflict" });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("an edit rejected by the currency rule (P0001) is currencyUnavailable, a lost membership (42501) a conflict", async () => {
    mocks.tables["invoice_items.update"] = { data: null, error: { code: "P0001", message: "invoices.invalid" } };
    expect(await updateItem(item, { name: "Cement", priceMinor: 1, currency: "EUR", decimalPlaces: 2 })).toEqual({ ok: false, error: "currencyUnavailable" });
    mocks.tables["invoice_items.update"] = { data: null, error: { code: "42501", message: "invoices.invalid" } };
    expect(await updateItem(item, { name: "Cement", priceMinor: 1 })).toEqual({ ok: false, error: "conflict" });
  });

  it("maps database rules", async () => {
    mocks.tables["invoice_items.update"] = { data: null, error: { message: "invoices.invalid" } };
    expect(await updateItem(item, { name: "Cement", priceMinor: 1, currency: "EUR", decimalPlaces: 2 })).toEqual({ ok: false, error: "conflict" });
    mocks.tables["invoice_items.update"] = { data: null, error: { message: "internal details" } };
    expect(await updateItem(item, { name: "Cement", priceMinor: 1 })).toEqual({ ok: false, error: "failed" });
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

  it("switches the link off", async () => {
    expect(await disableLink(folder)).toEqual({ ok: true });
    expect(rpcCalled("disable_invoice_link")).toEqual([["disable_invoice_link", { p_folder: folder }]]);
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
