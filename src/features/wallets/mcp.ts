import "server-only";
import { getCurrencies } from "@/features/currencies/queries";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool } from "@/lib/mcp/tool";
import { getWallets } from "./queries";

export const walletTools = [
  defineTool({
    name: "wallets_list",
    title: "List wallets",
    description:
      "List the person's wallets, each with one balance per currency (current balance as amount, opening balance, ids). " +
      "Balances in different currencies are never summed. Use the balance ids as balanceId filters in transactions_list.",
    kind: "read",
    run: async () => {
      const [wallets, currencies] = await Promise.all([getWallets(), getCurrencies()]);
      const amount = amountFormatter(currencies);
      return {
        wallets: wallets.map((wallet) => ({
          ...wallet,
          balances: wallet.balances.map((balance) => ({
            ...balance,
            amount: amount(balance.balanceMinor, balance.currency),
            openingAmount: amount(balance.openingBalanceMinor, balance.currency),
          })),
        })),
      };
    },
  }),
];
