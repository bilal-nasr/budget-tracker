import "server-only";
import { getCurrencies } from "@/features/currencies/queries";
import { getProfile } from "@/features/profile/queries";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool } from "@/lib/mcp/tool";
import { getInstallments } from "./queries";

export const installmentTools = [
  defineTool({
    name: "installments_list",
    title: "List installments",
    description:
      "List installment plans with, per plan: `total`, `paidBefore` (paid before the plan was tracked here), `paid` (paid so far, including `paidBefore`), " +
      "`remaining` (still owed overall; `paid` + `remaining` = `total`), the planned `monthly` amount (null when open-ended) and `dueDay`. " +
      "This salary cycle: `paidThisCycle` (only payments in the current salary cycle), `cyclePaymentCount`, `cycleLatestPaymentId` and `cycleStatus` " +
      "(unpaid, partial, paid or paidOff). Individual payments are not listed; use transactions_list for them. Each plan has one currency.",
    kind: "read",
    run: async () => {
      const profile = await getProfile();
      const [installments, currencies] = await Promise.all([getInstallments(profile.timezone), getCurrencies()]);
      const amount = amountFormatter(currencies);
      return {
        installments: installments.map((installment) => {
          const { currency } = installment;
          // The summary query never fills the payment history (`payments` is always empty,
          // `historyComplete` false), so neither is passed on.
          const plan: Partial<typeof installment> = { ...installment };
          delete plan.payments;
          delete plan.historyComplete;
          return {
            ...plan,
            total: amount(installment.totalMinor, currency),
            paidBefore: amount(installment.paidBeforeMinor, currency),
            monthly: installment.monthlyMinor === null ? null : amount(installment.monthlyMinor, currency),
            paid: amount(installment.paidMinor, currency),
            remaining: amount(installment.remainingMinor, currency),
            paidThisCycle: amount(installment.paidThisCycleMinor, currency),
          };
        }),
      };
    },
  }),
];
