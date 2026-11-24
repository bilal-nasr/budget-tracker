import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { amountFormatter } from "@/lib/mcp/amounts";
import { defineTool } from "@/lib/mcp/tool";
import { getLoanHistory, getLoans } from "./queries";

const nullable = <T>(value: number | null, format: (minor: number) => T): T | null => (value === null ? null : format(value));

export const loanTools = [
  defineTool({
    name: "loans_list",
    title: "List loans",
    description:
      "List loans the person borrowed or lent: principal, fee, total due, what is paid and what remains (principal and fee separately), and the planned monthly payment. " +
      "`remaining` is still owed in total; each loan has one currency and loans in different currencies are never summed. A loan's disbursements and repayments (its events) are not listed here; use loans_history with a loan id for them. " +
      "Archived and deleted loans are included and flagged: `archivedAt` is set on an archived loan and `deletedAt` on a deleted one; do not count a deleted loan as live.",
    kind: "read",
    run: async () => {
      const [loans, currencies] = await Promise.all([getLoans(), getCurrencies()]);
      const amount = amountFormatter(currencies);
      return {
        loans: loans.map((loan) => {
          const money = (minor: number) => amount(minor, loan.currency);
          // getLoans never fills the event history from the database (`events` is always empty,
          // `historyComplete` false), so neither is passed on; loans_history reads the events.
          const rest: Partial<typeof loan> = { ...loan };
          delete rest.events;
          delete rest.historyComplete;
          return {
            ...rest,
            principal: money(loan.principalMinor),
            fee: money(loan.feeMinor),
            totalDue: money(loan.totalDueMinor),
            principalPaidBefore: money(loan.principalPaidBeforeMinor),
            feePaidBefore: money(loan.feePaidBeforeMinor),
            principalPaid: money(loan.principalPaidMinor),
            feePaid: money(loan.feePaidMinor),
            principalRemaining: money(loan.principalRemainingMinor),
            feeRemaining: money(loan.feeRemainingMinor),
            remaining: money(loan.remainingMinor),
            monthlyPayment: nullable(loan.monthlyPaymentMinor, money),
            finalPayment: nullable(loan.finalPaymentMinor, money),
          };
        }),
      };
    },
  }),
  defineTool({
    name: "loans_history",
    title: "Loan history",
    description:
      "One page (30 events) of a loan's disbursements and repayments, newest first, each split into principal and fee. " +
      "Get `loanId` from loans_list; when `next` is not null pass it back as `before` for older events. " +
      "Deleted events are included and flagged with `deletedAt`; they no longer count toward what is paid.",
    kind: "read",
    input: z.object({ loanId: z.uuid(), before: z.number().int().optional() }),
    run: async ({ loanId, before }) => {
      const [page, loans, currencies] = await Promise.all([getLoanHistory(loanId, before ?? null), getLoans(), getCurrencies()]);
      const amount = amountFormatter(currencies);
      // Every event of a loan is in the loan's currency; without the loan the amounts stay raw.
      const currency = loans.find((loan) => loan.id === loanId)?.currency;
      return {
        rows: page.rows.map((event) => currency
          ? { ...event, amount: amount(event.amountMinor, currency), principal: amount(event.principalMinor, currency), fee: amount(event.feeMinor, currency) }
          : event),
        next: page.next,
      };
    },
  }),
];
