import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { getWallets } from "@/features/wallets/queries";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool } from "@/lib/mcp/tool";
import { fetchTransactions } from "./queries";
import { cursorSchema, filtersSchema } from "./schema";

export const transactionTools = [
  defineTool({
    name: "transactions_list",
    title: "List transactions",
    description:
      "List one page of transactions, newest first, optionally filtered by text, kind, balance, category and dates. " +
      "When `next` is not null, pass it back as `cursor` to get the following page. " +
      "`amount`/`currency` are the purchase cost in the cost currency, and `items` (a descriptive breakdown) are in that currency too. " +
      "For a cash purchase, what was actually paid and returned is in `settlement`: `tender` (from the paying balance), `extraTenders` and `changes`, each in its own currency. " +
      "For a transfer or exchange, `amount` is what left the source balance and `toAmount` is what arrived in the destination balance, in that balance's currency. " +
      "Never add amounts in different currencies.",
    kind: "read",
    input: z.object({ filters: filtersSchema.optional(), cursor: cursorSchema.optional() }),
    run: async ({ filters, cursor }) => {
      const [page, currencies] = await Promise.all([fetchTransactions(filters ?? {}, cursor ?? null), getCurrencies()]);
      const amount = amountFormatter(currencies);
      // The destination currency of a transfer is the destination balance's; deleted and
      // disabled balances are included so history still resolves.
      const needsBalances = page.rows.some((row) => row.toBalanceId !== null && row.toAmountMinor !== null);
      const wallets = needsBalances
        ? await getWallets({ includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true })
        : [];
      const currencyOf = new Map(wallets.flatMap((wallet) => wallet.balances.map((balance) => [balance.id, balance.currency] as const)));
      return {
        rows: page.rows.map((row) => {
          const toCurrency = row.toBalanceId === null ? undefined : currencyOf.get(row.toBalanceId);
          const { settlement } = row;
          return {
            ...row,
            amount: amount(row.amountMinor, row.currency),
            // Without the destination balance's currency the received amount stays raw rather than risk a wrong figure.
            ...(row.toAmountMinor !== null && toCurrency ? { toAmount: amount(row.toAmountMinor, toCurrency) } : {}),
            ...(row.loanPrincipalMinor !== null ? { loanPrincipal: amount(row.loanPrincipalMinor, row.currency) } : {}),
            ...(row.loanFeeMinor !== null ? { loanFee: amount(row.loanFeeMinor, row.currency) } : {}),
            // Breakdown lines itemize the purchase cost, so they share its currency.
            items: row.items.map((item) => ({ ...item, amount: amount(item.amountMinor, row.currency) })),
            settlement: settlement && {
              ...settlement,
              tender: amount(settlement.tenderMinor, settlement.tenderCurrency),
              ...(settlement.extraTenders
                ? { extraTenders: settlement.extraTenders.map((line) => ({ ...line, amount: amount(line.amountMinor, line.currency) })) }
                : {}),
              changes: settlement.changes.map((line) => ({ ...line, amount: amount(line.amountMinor, line.currency) })),
            },
          };
        }),
        next: page.next,
      };
    },
  }),
];
