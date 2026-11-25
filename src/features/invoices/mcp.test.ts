import { beforeEach, expect, test, vi } from "vitest";
import { SEED_CURRENCY_DEFINITIONS } from "@/lib/currency";

vi.mock("server-only", () => ({}));
const getInvoiceFolders = vi.fn();
const getInvoiceFolder = vi.fn();
const getCurrencies = vi.fn();
vi.mock("./queries", () => ({
  getInvoiceFolders: () => getInvoiceFolders(),
  getInvoiceFolder: (...args: unknown[]) => getInvoiceFolder(...args),
}));
const createFolder = vi.fn();
const renameFolder = vi.fn();
const deleteFolder = vi.fn();
vi.mock("./actions", () => ({
  createFolder: (...args: unknown[]) => createFolder(...args),
  renameFolder: (...args: unknown[]) => renameFolder(...args),
  deleteFolder: (...args: unknown[]) => deleteFolder(...args),
}));
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
import { ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT } from "@/lib/mcp/write";
import { invoiceTools } from "./mcp";

const tool = (name: string) => invoiceTools.find((t) => t.name === name)!;
const FOLDER_ID = "33333333-3333-4333-8333-333333333333";
const item = (id: string, currency: string, decimalPlaces: number, priceMinor: number, quantity: number) => ({
  id, folderId: FOLDER_ID, categoryId: "c1", name: id, currency, decimalPlaces, priceMinor, quantity,
  createdBy: null, createdAt: "x", updatedAt: "x", paidOn: null, paidAt: null, paidBy: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  getCurrencies.mockResolvedValue(SEED_CURRENCY_DEFINITIONS);
});

test("invoices_folders_list adds a total beside each per-currency total and skips overflowed ones", async () => {
  getInvoiceFolders.mockResolvedValue([{
    id: FOLDER_ID, name: "PC", isOwner: true, memberCount: 1, itemCount: 3,
    totals: [
      { currency: "USD", decimalPlaces: 2, minor: 55000 },
      { currency: "LBP", decimalPlaces: 0, minor: 1575000 },
      { currency: "SYP", decimalPlaces: 0, minor: null },
      { currency: "USD", decimalPlaces: 3, minor: 1000 },
    ],
  }]);
  expect(tool("invoices_folders_list").kind).toBe("read");
  const out = (await tool("invoices_folders_list").run({})) as { folders: { totals: Record<string, unknown>[] }[] };
  const { totals } = out.folders[0];
  expect(totals[0]).toMatchObject({ minor: 55000, total: { minor: 55000, currency: "USD", text: "$550.00" } });
  expect(totals[1]).toMatchObject({ total: { currency: "LBP", text: "LBP 1,575,000" } });
  expect(totals[2]).not.toHaveProperty("total");
  expect(totals[3]).not.toHaveProperty("total");
});

test("invoices_folder_get rejects a non-uuid id", () => {
  expect(tool("invoices_folder_get").input!.safeParse({ folderId: "nope" }).success).toBe(false);
  expect(tool("invoices_folder_get").input!.safeParse({ folderId: FOLDER_ID }).success).toBe(true);
});

test("invoices_folder_get formats item rows, omits the join link and its on/off switch, and keeps the rest", async () => {
  getInvoiceFolder.mockResolvedValue({
    id: FOLDER_ID, name: "PC", isOwner: true, viewerId: "u1", linkEnabled: true, link: "a".repeat(64),
    items: [item("gpu", "USD", 2, 45000, 2), item("odd", "USD", 3, 1000, 1)],
    categories: [{ id: "c1", folderId: FOLDER_ID, name: "Other", isDefault: true, createdAt: "x" }],
    members: [{ userId: "u1", displayName: null, isOwner: true, joinedAt: "x", removed: false }],
  });
  const out = (await tool("invoices_folder_get").run({ folderId: FOLDER_ID })) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(getInvoiceFolder).toHaveBeenCalledWith(FOLDER_ID);
  expect(out).not.toHaveProperty("link");
  expect(JSON.stringify(out)).not.toContain("a".repeat(64));
  // A connected app cannot read link rows, so the switch would always read "on": not returned.
  expect(out).not.toHaveProperty("linkEnabled");
  expect(out).toMatchObject({ id: FOLDER_ID, name: "PC", isOwner: true, viewerId: "u1" });
  expect(out.members).toHaveLength(1);
  expect(out.items[0]).toMatchObject({
    priceMinor: 45000, price: { minor: 45000, currency: "USD", text: "$450.00" }, lineTotal: { minor: 90000, text: "$900.00" },
  });
  // Different decimals than the currency's: raw only, never a mis-scaled figure.
  expect(out.items[1]).not.toHaveProperty("price");
  expect(out.items[1].priceMinor).toBe(1000);
});

test("invoices_folder_get on a missing folder is a tool error", async () => {
  getInvoiceFolder.mockResolvedValue(null);
  await expect(tool("invoices_folder_get").run({ folderId: FOLDER_ID })).rejects.toMatchObject({ name: "ToolError", message: "Folder not found." });
  await expect(tool("invoices_folder_get").run({ folderId: FOLDER_ID })).rejects.toBeInstanceOf(ToolError);
});

test("invoices_folder_get says the owner also sees removed members, flagged", () => {
  const { description } = tool("invoices_folder_get");
  expect(description).not.toMatch(/and active members/);
  expect(description).toMatch(/removed: true/);
  expect(description).toMatch(/owner/i);
});

test("invoices_folder_get says neither the join link nor whether joining is on is returned", () => {
  const { description } = tool("invoices_folder_get");
  expect(description).toMatch(/join link/);
  expect(description).toMatch(/whether joining is (switched )?on/);
  expect(description).not.toMatch(/linkEnabled/);
});

const REQ = "44444444-4444-4444-8444-444444444444";
const detail = (id: string, name: string) => ({
  id, name, isOwner: true, viewerId: "u1", linkEnabled: true, link: "a".repeat(64),
  items: [], categories: [{ id: "c1", folderId: id, name: "Other", isDefault: true, createdAt: "x" }],
  members: [{ userId: "u1", displayName: null, isOwner: true, joinedAt: "x", removed: false }],
});

test("folder write tools come after the read tools and have the right kinds", () => {
  expect(invoiceTools[0].name).toBe("invoices_folders_list");
  expect(invoiceTools[1].name).toBe("invoices_folder_get");
  expect(tool("invoices_folders_create").kind).toBe("write");
  expect(tool("invoices_folders_update").kind).toBe("write");
  expect(tool("invoices_folders_delete").kind).toBe("destructive");
});

test("invoices_folders_create uses the requestId as the folder id and returns the folder without its link", async () => {
  createFolder.mockResolvedValue({ ok: true });
  getInvoiceFolder.mockResolvedValue(detail(REQ, "PC"));
  const out = (await tool("invoices_folders_create").run({ name: " PC ", requestId: REQ })) as Record<string, unknown>;
  expect(createFolder).toHaveBeenCalledWith({ id: REQ, name: " PC " });
  expect(getInvoiceFolder).toHaveBeenCalledWith(REQ);
  expect(out).toMatchObject({ id: REQ, name: "PC" });
  expect(out).not.toHaveProperty("link");
  expect(out).not.toHaveProperty("linkEnabled");
});

test("invoices_folders_create generates an id without a requestId", async () => {
  createFolder.mockImplementation(async (input: { id: string; name: string }) => {
    getInvoiceFolder.mockResolvedValue(detail(input.id, input.name));
    return { ok: true };
  });
  const out = (await tool("invoices_folders_create").run({ name: "PC" })) as { id: string };
  expect(out.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(createFolder.mock.calls[0][0].id).toBe(out.id);
});

test("invoices_folders_create with a reused requestId returns the existing folder", async () => {
  createFolder.mockResolvedValue({ ok: true }); // the action treats an own existing id as done
  getInvoiceFolder.mockResolvedValue(detail(REQ, "PC"));
  const first = await tool("invoices_folders_create").run({ name: "PC", requestId: REQ });
  const second = await tool("invoices_folders_create").run({ name: "PC", requestId: REQ });
  expect(second).toEqual(first);
});

test("invoices_folders_create refuses a requestId whose folder has another name or is not visible", async () => {
  createFolder.mockResolvedValue({ ok: true });
  getInvoiceFolder.mockResolvedValue(detail(REQ, "Other name"));
  await expect(tool("invoices_folders_create").run({ name: "PC", requestId: REQ })).rejects.toBeInstanceOf(ToolError);
  getInvoiceFolder.mockResolvedValue(null);
  await expect(tool("invoices_folders_create").run({ name: "PC", requestId: REQ })).rejects.toMatchObject({ message: expect.stringContaining("requestId") });
});

test("invoices_folders_create turns an action error into the fixed sentence", async () => {
  createFolder.mockResolvedValue({ ok: false, error: "limitReached" });
  await expect(tool("invoices_folders_create").run({ name: "PC", requestId: REQ }))
    .rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.limitReached });
});

test("invoices_folders_create input is strict and validates", () => {
  const input = tool("invoices_folders_create").input!;
  expect(input.safeParse({ name: "PC" }).success).toBe(true);
  expect(input.safeParse({ name: "PC", id: REQ }).success).toBe(false);
  expect(input.safeParse({ name: "" }).success).toBe(false);
  expect(input.safeParse({ name: "x".repeat(61) }).success).toBe(false);
  expect(input.safeParse({ name: "PC", requestId: "nope" }).success).toBe(false);
});

test("invoices_folders_update renames and returns the re-read folder", async () => {
  renameFolder.mockResolvedValue({ ok: true });
  getInvoiceFolder.mockResolvedValue(detail(FOLDER_ID, "New"));
  const out = await tool("invoices_folders_update").run({ folderId: FOLDER_ID, name: "New" });
  expect(renameFolder).toHaveBeenCalledWith(FOLDER_ID, { name: "New" });
  expect(out).toMatchObject({ id: FOLDER_ID, name: "New" });
});

test("invoices_folders_update turns an action error into the fixed sentence and validates input", async () => {
  renameFolder.mockResolvedValue({ ok: false, error: "conflict" });
  await expect(tool("invoices_folders_update").run({ folderId: FOLDER_ID, name: "New" }))
    .rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.conflict });
  const input = tool("invoices_folders_update").input!;
  expect(input.safeParse({ folderId: FOLDER_ID, name: "New" }).success).toBe(true);
  expect(input.safeParse({ folderId: FOLDER_ID, name: "New", extra: 1 }).success).toBe(false);
  expect(input.safeParse({ folderId: "nope", name: "New" }).success).toBe(false);
  expect(input.safeParse({ folderId: FOLDER_ID, name: "  " }).success).toBe(false);
  expect(input.safeParse({ folderId: FOLDER_ID }).success).toBe(false);
});

test("invoices_folders_delete returns { deleted, id } and says plainly what it removes", async () => {
  deleteFolder.mockResolvedValue({ ok: true });
  expect(await tool("invoices_folders_delete").run({ folderId: FOLDER_ID })).toEqual({ deleted: true, id: FOLDER_ID });
  expect(deleteFolder).toHaveBeenCalledWith(FOLDER_ID);
  const { description } = tool("invoices_folders_delete");
  expect(description).toMatch(/ALL its item rows/);
  expect(description).toMatch(/every other member loses access/);
  expect(description).toMatch(/cannot be undone/);
});

test("invoices_folders_delete turns an action error into the fixed sentence and validates input", async () => {
  deleteFolder.mockResolvedValue({ ok: false, error: "conflict" });
  await expect(tool("invoices_folders_delete").run({ folderId: FOLDER_ID }))
    .rejects.toMatchObject({ name: "ToolError", message: ACTION_ERROR_TEXT.conflict });
  const input = tool("invoices_folders_delete").input!;
  expect(input.safeParse({ folderId: FOLDER_ID }).success).toBe(true);
  expect(input.safeParse({ folderId: FOLDER_ID, extra: 1 }).success).toBe(false);
  expect(input.safeParse({ folderId: "nope" }).success).toBe(false);
});
