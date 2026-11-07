import { readMinor } from "@/lib/money";

/** The ledger columns needed to tell what a transaction did to each wallet balance. */
export type ActivityRow = {
  balance_id: string;
  kind: "income" | "expense" | string;
  amount_minor: number | string;
  tender_minor: number | string | null;
  cashier_changes: { balance_id: string; amount_minor: number | string }[] | null;
};

export type BalanceActivity = { incomeMinor: number; spentMinor: number };

/**
 * Income and spending per wallet balance, from the wallet's point of view (the
 * same view the balance itself uses): an expense takes the tender it was paid
 * with, and cash handed back as change flows into whichever balance received it.
 * Change that outweighs the tender in a balance counts as money in, so the
 * pieces always reconcile with the balance. Nothing here mixes currencies: a
 * balance holds exactly one.
 */
export function summarizeActivity(rows: readonly ActivityRow[]): Map<string, BalanceActivity> {
  const income = new Map<string, bigint>();
  const spent = new Map<string, bigint>();
  const add = (map: Map<string, bigint>, id: string, value: bigint) => map.set(id, (map.get(id) ?? BigInt(0)) + value);

  for (const row of rows) {
    if (row.kind === "income") {
      add(income, row.balance_id, BigInt(readMinor(row.amount_minor)));
    } else if (row.kind === "expense") {
      const net = new Map<string, bigint>();
      add(net, row.balance_id, BigInt(readMinor(row.tender_minor ?? row.amount_minor)));
      for (const change of row.cashier_changes ?? []) add(net, change.balance_id, -BigInt(readMinor(change.amount_minor)));
      for (const [id, value] of net) {
        if (value > BigInt(0)) add(spent, id, value);
        else if (value < BigInt(0)) add(income, id, -value);
      }
    }
  }

  const result = new Map<string, BalanceActivity>();
  for (const id of new Set([...income.keys(), ...spent.keys()])) {
    result.set(id, {
      incomeMinor: readMinor(String(income.get(id) ?? BigInt(0))),
      spentMinor: readMinor(String(spent.get(id) ?? BigInt(0))),
    });
  }
  return result;
}
