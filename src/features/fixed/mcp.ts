import "server-only";
import { getCurrencies } from "@/features/currencies/queries";
import { getProfile } from "@/features/profile/queries";
import { getWallets } from "@/features/wallets/queries";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool } from "@/lib/mcp/tool";
import { getFixedExpenses } from "./queries";

export const fixedTools = [
  defineTool({
    name: "fixed_expenses_list",
    title: "List fixed expenses",
    description:
      "List the recurring fixed expenses (rent, subscriptions and the like): amount, due day, and `paidOn`: the date of its newest payment recorded since the latest salary receipt was recorded " +
      "(with no salary recorded yet, paid on or after the 1st of the current calendar month), or null if it has not been paid in that period. " +
      "Each amount is in the currency of its paying balance; use wallets_list to see the balances and categories_list for category ids.",
    kind: "read",
    run: async () => {
      const profile = await getProfile();
      const [expenses, wallets, currencies] = await Promise.all([
        getFixedExpenses(profile.timezone),
        getWallets({ includeDeleted: true, includeNeedsAttention: true, includeDisabledBalances: true }),
        getCurrencies(),
      ]);
      const amount = amountFormatter(currencies);
      const currencyOf = new Map(wallets.flatMap((wallet) => wallet.balances.map((balance) => [balance.id, balance.currency] as const)));
      return {
        expenses: expenses.map((expense) => {
          const currency = currencyOf.get(expense.balanceId);
          // Without the paying balance's currency an amount stays raw rather than risk a wrong figure.
          if (!currency) return expense;
          return {
            ...expense,
            currency,
            amount: amount(expense.amountMinor, currency),
            ...(expense.items ? { items: expense.items.map((item) => ({ ...item, amount: amount(item.amountMinor, currency) })) } : {}),
          };
        }),
      };
    },
  }),
];
