import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool, ToolError } from "@/lib/mcp/tool";
import { getInvoiceFolder, getInvoiceFolders } from "./queries";
import { lineMinor } from "./totals";

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
    run: async ({ folderId }) => {
      const [folder, currencies] = await Promise.all([getInvoiceFolder(folderId), getCurrencies()]);
      if (!folder) throw new ToolError("Folder not found.");
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
    },
  }),
];
