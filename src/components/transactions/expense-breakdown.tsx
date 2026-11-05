import { Amount } from "@/components/money/amount";
import type { ExpenseBreakdownLabels } from "@/components/add/expense-breakdown-labels";
import { summarizeBreakdown } from "@/features/transactions/breakdown-summary";
import type { ExpenseItem } from "@/features/transactions/breakdown";

export type ExpenseBreakdownProps = {
  items: readonly ExpenseItem[];
  parentMinor: number;
  currency: string;
  labels: Pick<ExpenseBreakdownLabels, "title" | "itemizedTotal" | "remainder" | "fullyItemized">;
};

/** These amounts explain the parent cost; they are never ledger entries. */
export function ExpenseBreakdown({ items, parentMinor, currency, labels }: ExpenseBreakdownProps) {
  if (items.length === 0) return null;
  const summary = summarizeBreakdown(parentMinor, items);
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 className="text-[15px] font-semibold">{labels.title}</h3>
      <dl className="flex flex-col divide-y divide-border text-[15px]">
        {[...items].sort((a, b) => a.position - b.position).map((item) => (
          <div key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
            <dt className="min-w-0 break-words [overflow-wrap:anywhere]"><bdi>{item.description}</bdi></dt>
            <dd className="ms-auto"><Amount minor={item.amountMinor} currency={currency} /></dd>
          </div>
        ))}
        {summary.valid && summary.remainderMinor > 0 ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-muted-foreground">
            <dt>{labels.remainder}</dt><dd className="ms-auto"><Amount minor={summary.remainderMinor} currency={currency} /></dd>
          </div>
        ) : null}
      </dl>
      {summary.valid && summary.remainderMinor === 0 ? <p className="text-[13px] text-muted-foreground">{labels.fullyItemized}</p> : null}
    </section>
  );
}
