import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { activityOrClause, matchesActivityKind } from "./activity-filter";
import { emptyTransactionMetadata, reportingMinor, signedMinor, type Transaction } from "./schema";
import { groupByDay } from "./group";
import { demoLoanTransactions, demoLoans, demoPage, DEMO_WALLET_CONTAINERS, demoBudgetData } from "@/lib/demo-data";
import { todayIn } from "./group";

const loan = (over: Partial<Transaction> = {}): Transaction => ({ ...emptyTransactionMetadata(), id: "loan-payment", kind: "loan", source: "loan", loanId: "loan",
  loanEvent: "repayment", loanFlow: "out", loanPrincipalMinor: 60000, loanFeeMinor: 5000, loanEventSeq: 2,
  amountMinor: 65000, currency: "USD", balanceId: "wallet", categoryId: "fee", note: "Synthetic loan", occurredOn: "2026-11-04", createdAt: "2026-11-04T12:00:00Z", toBalanceId: null, toAmountMinor: null, ...over });
describe("loan Activity cash versus fee reporting", () => {
  it("shows full signed cash but groups only fee in both directions and currencies", () => {
    const borrowed = loan();
    const lent = loan({ loanFlow: "in", amountMinor: 21000, loanPrincipalMinor: 20000, loanFeeMinor: 1000, currency: "SYP" });
    const principal = loan({ loanEvent: "disbursement", loanFlow: "in", amountMinor: 10000, loanPrincipalMinor: 10000, loanFeeMinor: 0 });
    expect([signedMinor(borrowed), signedMinor(lent), signedMinor(principal)]).toEqual([-65000, 21000, 10000]);
    expect([reportingMinor(borrowed), reportingMinor(lent), reportingMinor(principal)]).toEqual([-5000, 1000, 0]);
    expect(groupByDay([borrowed, lent, principal])[0].totals).toEqual({ USD: -5000, SYP: 1000 });
  });
  it("classifies positive realized fees and leaves principal-only events to All/Loans", () => {
    expect(matchesActivityKind(loan(), "expense")).toBe(true);
    expect(matchesActivityKind(loan(), "income")).toBe(false);
    expect(matchesActivityKind(loan({ loanFlow: "in" }), "income")).toBe(true);
    expect(matchesActivityKind(loan({ loanFeeMinor: 0 }), "expense")).toBe(false);
    expect(matchesActivityKind(loan({ loanEvent: "disbursement", loanFeeMinor: 0 }), "loan")).toBe(true);
  });
  it("combines fee, all wallet roles, category and cursor without widening the page", () => {
    const clause = activityOrClause({ kind: "expense", balanceId: "w", categoryId: "c" }, { id: "t", occurredOn: "2026-11-04", createdAt: "2026-11-04T12:00:00Z" });
    expect(clause).toContain("and(or(balance_id.eq.w,to_balance_id.eq.w,change_balance_ids.cs.{w}),or(occurred_on.lt.");
    expect(clause).toContain("or(kind.eq.expense,and(kind.eq.loan,loan_event.eq.repayment,loan_flow.eq.out,loan_fee_minor.gt.0))");
    expect(clause).toContain("or(kind.neq.loan,and(loan_event.eq.repayment,loan_fee_minor.gt.0))");
    expect(activityOrClause({ kind: "loan" }, null)).toBeNull();
  });
});
describe("one shared synthetic loan ledger", () => {
  it("agrees across loan history, Activity, wallet balance and realized budget fee", () => {
    const loans = demoLoans(); const rows = demoLoanTransactions();
    expect(rows).toHaveLength(3);
    for (const item of loans) {
      const live = item.events.filter((e) => !e.deletedAt && e.event === "repayment");
      expect(item.principalPaidBeforeMinor + live.reduce((n, e) => n + e.principalMinor, 0)).toBe(item.principalPaidMinor);
      expect(item.feePaidBeforeMinor + live.reduce((n, e) => n + e.feeMinor, 0)).toBe(item.feePaidMinor);
      expect(item.totalDueMinor - item.principalPaidMinor - item.feePaidMinor).toBe(item.remainingMinor);
    }
    const wallet = DEMO_WALLET_CONTAINERS.find((w) => w.name === "Loan demo USD")!.balances.find((balance) => balance.currency === "USD")!;
    expect(wallet.openingBalanceMinor + rows.reduce((n, row) => n + signedMinor(row), 0)).toBe(wallet.balanceMinor);
    const expense = demoPage({ kind: "expense", q: "Loan repayment demo" }, null, 30);
    expect(expense.rows).toHaveLength(1);
    expect(groupByDay(expense.rows)[0].totals.USD).toBe(-5000);
    expect(demoPage({ kind: "income", q: "Loan income demo" }, null, 30).rows).toHaveLength(1);
    expect(demoPage({ kind: "expense", q: "Loan principal demo" }, null, 30).rows).toHaveLength(0);
    expect(demoPage({ kind: "loan", q: "Loan principal demo" }, null, 30).rows).toHaveLength(1);
    expect(demoBudgetData(todayIn("Asia/Beirut").slice(0, 7)).spend.find((s) => s.categoryId.endsWith("000000000112"))?.spentMinor).toBe(5000);
  });
});
