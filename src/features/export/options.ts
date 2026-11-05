import type { SheetKey } from "./labels";

/**
 * What an export contains. Shared by the settings form (builds the query),
 * the route (parses it) and the workbook builders, so it must stay free of
 * server-only imports.
 */

/** User-facing groups of worksheets for the detailed workbook. The cover is always included. */
export const SECTION_GROUPS = ["overview", "transactions", "wallets", "budgets", "recurring", "debts", "audit"] as const;
export type SectionGroup = (typeof SECTION_GROUPS)[number];

export const GROUP_SHEETS: Record<SectionGroup, readonly SheetKey[]> = {
  overview: ["summary", "checks"],
  transactions: ["transactions", "expenseItems", "walletLedger"],
  wallets: ["wallets", "balances", "reconciliation", "currencies"],
  budgets: ["monthlyActivity", "budgetActual", "categories"],
  recurring: ["salary", "fixedExpenses", "installments", "installmentPayments"],
  debts: ["loans", "loanPayments", "receivables", "receipts"],
  audit: ["exactFacts"],
};

export const SIMPLE_PERIODS = ["cycle", "month", "all"] as const;
export type SimplePeriod = (typeof SIMPLE_PERIODS)[number];

export type DetailedExportOptions = { mode: "detailed"; sections: readonly SectionGroup[] };
export type SimpleExportOptions = {
  mode: "simple";
  period: SimplePeriod;
  /** Add the current balance of every wallet, with a total per currency. */
  balances: boolean;
  /** Include the free-text note column. */
  notes: boolean;
};
export type ExportOptions = DetailedExportOptions | SimpleExportOptions;

export const DEFAULT_DETAILED: DetailedExportOptions = { mode: "detailed", sections: SECTION_GROUPS };
export const DEFAULT_SIMPLE: SimpleExportOptions = { mode: "simple", period: "cycle", balances: true, notes: true };

/** Worksheets kept in a detailed workbook for a selection of groups. */
export function selectedSheets(sections: readonly SectionGroup[]): Set<SheetKey> {
  const keys = new Set<SheetKey>(["cover"]);
  for (const group of sections) for (const key of GROUP_SHEETS[group]) keys.add(key);
  return keys;
}

/** Query string the settings form sends to the export route. */
export function exportQuery(options: ExportOptions): string {
  const params = new URLSearchParams({ mode: options.mode });
  if (options.mode === "detailed") {
    params.set("sections", options.sections.join(","));
  } else {
    params.set("period", options.period);
    params.set("balances", options.balances ? "1" : "0");
    params.set("notes", options.notes ? "1" : "0");
  }
  return params.toString();
}

function flag(value: string | null, fallback: boolean): boolean | null {
  if (value === null) return fallback;
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

/**
 * Parse the route's query string. No parameters means the full detailed
 * workbook, exactly as before options existed. Returns null for anything
 * unrecognised so the route can answer 400 instead of guessing.
 */
export function parseExportOptions(params: URLSearchParams): ExportOptions | null {
  const mode = params.get("mode") ?? "detailed";
  if (mode === "detailed") {
    const raw = params.get("sections");
    if (raw === null) return DEFAULT_DETAILED;
    const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
    const groups = new Set<SectionGroup>();
    for (const part of parts) {
      if (!(SECTION_GROUPS as readonly string[]).includes(part)) return null;
      groups.add(part as SectionGroup);
    }
    if (groups.size === 0) return null;
    return { mode: "detailed", sections: SECTION_GROUPS.filter((group) => groups.has(group)) };
  }
  if (mode === "simple") {
    const period = params.get("period") ?? DEFAULT_SIMPLE.period;
    if (!(SIMPLE_PERIODS as readonly string[]).includes(period)) return null;
    const balances = flag(params.get("balances"), DEFAULT_SIMPLE.balances);
    const notes = flag(params.get("notes"), DEFAULT_SIMPLE.notes);
    if (balances === null || notes === null) return null;
    return { mode: "simple", period: period as SimplePeriod, balances, notes };
  }
  return null;
}
