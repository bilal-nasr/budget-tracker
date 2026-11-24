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
vi.mock("@/features/currencies/queries", () => ({ getCurrencies: () => getCurrencies() }));
import { ToolError } from "@/lib/mcp/tool";
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
