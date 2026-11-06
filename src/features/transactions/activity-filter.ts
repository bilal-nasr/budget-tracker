import type { Cursor, Filters, Transaction } from "./schema";

/** A loan contributes a category/income/expense entry only when a fee is realized. */
export function matchesActivityKind(row: Transaction, kind: Filters["kind"]): boolean {
  if (!kind) return true;
  if (row.kind === kind) return true;
  return (kind === "expense" || kind === "income") && row.kind === "loan" && row.loanEvent === "repayment"
    && (row.loanFeeMinor ?? 0) > 0 && row.loanFlow === (kind === "expense" ? "out" : "in");
}

/** One combined PostgREST OR expression so wallet/cursor/kind clauses stay ANDed. */
export function activityOrClause(filters: Filters, cursor: Cursor | null): string | null {
  const groups: string[] = [];
  if (filters.balanceId) {
    groups.push(filters.balanceId.split(",")
      .map((id) => `balance_id.eq.${id},to_balance_id.eq.${id},change_balance_ids.cs.{${id}}`).join(","));
  }
  if (cursor) groups.push(`occurred_on.lt.${cursor.occurredOn},and(occurred_on.eq.${cursor.occurredOn},created_at.lt."${cursor.createdAt}"),and(occurred_on.eq.${cursor.occurredOn},created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`);
  if (filters.kind === "expense" || filters.kind === "income") {
    groups.push(`kind.eq.${filters.kind},and(kind.eq.loan,loan_event.eq.repayment,loan_flow.eq.${filters.kind === "expense" ? "out" : "in"},loan_fee_minor.gt.0)`);
  }
  if (filters.categoryId) groups.push("kind.neq.loan,and(loan_event.eq.repayment,loan_fee_minor.gt.0)");
  return groups.length === 0 ? null : groups.length === 1 ? groups[0] : `and(${groups.map((group) => `or(${group})`).join(",")})`;
}
