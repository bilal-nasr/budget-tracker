import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool, ToolError } from "@/lib/mcp/tool";
import { requestIdSchema, unwrap } from "@/lib/mcp/write";
import { createFolder, deleteFolder, renameFolder } from "./actions";
import { getInvoiceFolder, getInvoiceFolders, type InvoiceFolderDetail } from "./queries";
import { folderCreateSchema } from "./schema";
import { lineMinor } from "./totals";

const FOLDER_NOT_FOUND = "Folder not found.";
const REQUEST_TAKEN = "This requestId already belongs to a different folder. Use a new requestId.";
const REQUEST_DIFFERENT = "This requestId was already used with a different name. Use a new requestId.";

/** One folder the way invoices_folder_get shows it. */
function folderOut(folder: InvoiceFolderDetail, currencies: Awaited<ReturnType<typeof getCurrencies>>) {
  const amount = amountFormatter(currencies);
  const decimalsOf = new Map(currencies.map((currency) => [currency.code, currency.decimalPlaces]));
  // The join link is a credential for adding people; a connector has no need to read it.
  // The database hides link rows from connected apps, so `linkEnabled` would always read
  // "on" here whatever the owner chose: it is left out rather than reported wrongly.
  const copy: Partial<typeof folder> = { ...folder };
  delete copy.link;
  delete copy.linkEnabled;
  return {
    ...copy,
    items: folder.items.map((item) => {
      // A row can carry its own decimals; only format when they match the currency's.
      if (decimalsOf.get(item.currency) !== item.decimalPlaces) return item;
      return { ...item, price: amount(item.priceMinor, item.currency), lineTotal: amount(lineMinor(item), item.currency) };
    }),
  };
}

/** The folder re-read through the same query and shape as invoices_folder_get; "Folder not found." when the person cannot see it. */
async function readFolder(id: string) {
  const [folder, currencies] = await Promise.all([getInvoiceFolder(id), getCurrencies()]);
  if (!folder) throw new ToolError(FOLDER_NOT_FOUND);
  return folderOut(folder, currencies);
}

const folderId = z.uuid().describe("The folder's id, from invoices_folders_list.");
const nameField = folderCreateSchema.shape.name.describe("The folder's name (1 to 60 characters).");

export const invoiceTools = [
  defineTool({
    name: "invoices_folders_list",
    title: "List invoice folders",
    description:
      "List the shared invoice folders the person owns or has joined, with member and item counts and one total per currency (never summed across currencies). " +
      "Use invoices_folder_get with a folder id for the items.",
    kind: "read",
    run: async () => {
      const [folders, currencies] = await Promise.all([getInvoiceFolders(), getCurrencies()]);
      const amount = amountFormatter(currencies);
      const decimalsOf = new Map(currencies.map((currency) => [currency.code, currency.decimalPlaces]));
      return {
        folders: folders.map((folder) => ({
          ...folder,
          totals: folder.totals.map((total) => ({
            ...total,
            // A row can carry its own decimals; only format when they match the currency's, and never for an overflowed (null) sum.
            ...(total.minor !== null && decimalsOf.get(total.currency) === total.decimalPlaces ? { total: amount(total.minor, total.currency) } : {}),
          })),
        })),
      };
    },
  }),
  defineTool({
    name: "invoices_folder_get",
    title: "Get invoice folder",
    description:
      "One invoice folder: its items (`price` is ONE unit, `lineTotal` is price times quantity, `paidOn` set means paid), categories and members. " +
      "A member sees the active members only; the folder's owner also sees removed members, flagged `removed: true`, who are no longer in the folder. " +
      "Get `folderId` from invoices_folders_list; fails if the person is not an active member. " +
      "Neither the folder's join link nor whether joining is switched on is returned.",
    kind: "read",
    input: z.object({ folderId: z.uuid() }),
    run: async ({ folderId }) => readFolder(folderId),
  }),
  defineTool({
    name: "invoices_folders_create",
    title: "Create invoice folder",
    description:
      "Create a new, empty invoice folder owned by the person (at most 100 folders). Moves no money. " +
      "Returns the folder in the invoices_folder_get shape, including its `id`; use that id with invoices_folder_get, invoices_folders_update and invoices_folders_delete. " +
      "Send the same `requestId` when retrying so the folder is never created twice.",
    kind: "write",
    input: z.strictObject({ name: nameField, requestId: requestIdSchema }),
    run: async ({ name, requestId }) => {
      // The request id is the folder id, so a retry (even after a lost response) finds the same folder.
      const id = requestId ?? crypto.randomUUID();
      unwrap(await createFolder({ id, name }));
      const folder = await readFolder(id).catch((error: unknown) => {
        if (error instanceof ToolError && error.message === FOLDER_NOT_FOUND) throw new ToolError(REQUEST_TAKEN);
        throw error;
      });
      if (folder.name !== name.trim()) throw new ToolError(REQUEST_DIFFERENT);
      return folder;
    },
  }),
  defineTool({
    name: "invoices_folders_update",
    title: "Rename invoice folder",
    description:
      "Rename an invoice folder (get `folderId` from invoices_folders_list). Only the folder's owner can rename it. " +
      "Returns the folder in the invoices_folder_get shape.",
    kind: "write",
    input: z.strictObject({ folderId, name: nameField }),
    run: async ({ folderId: id, name }) => {
      unwrap(await renameFolder(id, { name }));
      return readFolder(id);
    },
  }),
  defineTool({
    name: "invoices_folders_delete",
    title: "Delete invoice folder",
    description:
      "PERMANENTLY delete an invoice folder (get `folderId` from invoices_folders_list). Only the folder's owner can do it. " +
      "It removes the folder together with ALL its item rows (paid and unpaid), its categories and its share link, and every other member loses access to the folder and its rows immediately. " +
      "It cannot be undone, and the rows cannot be restored. Expenses already recorded in Activity when rows were paid are separate and stay. " +
      "Ask the person to confirm before calling. Returns { deleted: true, id }; a folder that is already gone also counts as deleted.",
    kind: "destructive",
    input: z.strictObject({ folderId }),
    run: async ({ folderId: id }) => {
      unwrap(await deleteFolder(id));
      return { deleted: true, id };
    },
  }),
];
