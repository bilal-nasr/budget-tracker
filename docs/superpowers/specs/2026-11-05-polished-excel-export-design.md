# Accountant-ready Excel export

## Intent

Add a one-click Excel export to Settings so a signed-in user can download all useful budget data as an accountant-ready workpaper: traceable to the app, reconciled to wallet balances, easy to filter, and safe to hand to an accountant.

## Goals

- Export wallets, categories, transactions, expense breakdowns, budgets, salary configuration, fixed expenses, installments and payments, loans and repayments, and pending payments and receipts.
- Include archived wallets, categories, loans, and other archived records where available.
- Exclude soft-deleted records and internal operational tables.
- Resolve wallet and category references to readable names while retaining identifiers in secondary columns for traceability.
- Use native Excel values for dates, amounts, percentages, and currencies.
- Keep USD, LBP, and SYP reporting separate. Never add different currencies together or silently convert them.
- Produce a polished workbook with a Cover, Financial Summary, Reconciliation, Monthly Activity, Wallet Ledger, and supporting schedules.
- Reconcile each wallet as opening balance plus inflows less outflows equals exported closing balance, with a visible difference check to 0.00.
- Provide an audit trail from summary schedules to source transaction, wallet, category, and related loan/installment/receivable identifiers.
- Use accountant-friendly signs and formats: separate inflow and outflow columns, parenthesized negatives, dash zeros, explicit currency, and unrounded source values.
- Add control totals and record counts so missing or incomplete extracts are visible.
- Localize the entire workbook to the user's active English or Arabic app locale: sheet names, titles, column headers, statuses, definitions, and notes. Preserve user-entered names and notes exactly as stored.
- Generate the workbook on the server under the signed-in user's existing Supabase session and row-level security rules.

## Non-goals

- This is not a raw database backup or restore format.
- This is not a double-entry general ledger, trial balance, income statement, or tax return. The app does not store a chart of accounts, debit/credit journals, accrual entries, or tax classifications, so the export will not invent them.
- Deleted history, authentication data, internal request receipts, and implementation-only metadata are not exported.
- The first version will not add date-range or sheet-selection controls.
- The workbook will not edit or synchronize data back into the app.

## Constraints

- The app uses Next.js 16.4.5, so the implementation will follow the installed Route Handler and Server/Client Component guidance.
- Large datasets must be read in stable pages rather than relying on PostgREST's default row limit.
- Monetary values stored in minor units must be converted to typed Excel major-unit numbers using each currency's precision.
- The export must work for both live Supabase data and the app's unconfigured demo mode.
- Transaction reporting is cash-based because the source app records cash events. Pending payments remain a separate receivables schedule until received.
- The workbook has an explicit export timestamp, reporting cutoff, source description, and scope notes.

## Approaches considered

1. **Accountant-ready workpaper — selected and refined.** Reconciled financial summaries, a wallet ledger, control checks, and supporting schedules with readable labels and Excel-native values. Best for review and handoff to an accountant.
2. **Raw audit workbook.** A direct table-by-table dump including deleted and technical records. More complete as a backup, but difficult to read and not the requested experience.
3. **Current-view exports.** Separate exports from each screen, limited to the current month or filter. Simpler per screen, but does not satisfy a single export for everything.

## Proposed experience

Settings gains an **Export to Excel** section describing the accountant-ready workbook and one button. Pressing it starts a server-generated `.xlsx` download and shows a busy state. If generation fails, the user sees a localized retry message.

The workbook opens on **Cover**, which states the owner-neutral source, reporting cutoff, export timestamp, cash basis, currencies, included records, and limitations. The primary workpapers follow:

- **Financial Summary:** wallet balances, cash income, cash expenses, net cash activity, budget versus actual, loan balances, installment obligations, and outstanding receivables, always separated by currency.
- **Reconciliation:** one row per wallet showing opening balance, inflows, outflows, transfer activity, calculated closing balance, app closing balance, and difference. Any non-zero difference is highlighted as an exception.
- **Monthly Activity:** monthly cash inflows, cash outflows, and net activity by currency, with totals linked to the detailed wallet ledger.
- **Wallet Ledger:** one row for every wallet impact. Transfers create an outflow leg and an inflow leg so each wallet can be reconciled independently. Rows retain the source transaction ID and related schedule IDs.
- **Budget vs Actual:** month, category, currency, budget, actual expense, variance amount, variance percent when meaningful, and favorable/unfavorable status.
- **Supporting schedules:** Transactions, Expense Items, Wallets, Categories, Salary, Fixed Expenses, Installments, Installment Payments, Loans, Loan Payments, Receivables, and Receipts.
- **Checks & Definitions:** extract counts, control totals, reconciliation status, field definitions, sign convention, and limitations.

Reader-facing sheets use restrained finance styling, hidden gridlines, compact titles, accounting number formats, clear total rows, and exception-only conditional formatting. Detail schedules use filterable Excel tables, frozen headers, readable names, typed dates and amounts, and stable source identifiers. English exports use left-to-right layout. Arabic exports use translated worksheet names and labels plus right-to-left worksheet layout.

## Builder decisions

- Use a maintained XLSX library that supports styles, tables, frozen panes, and server-side buffer generation.
- Keep workbook assembly in testable server-only modules; keep the route handler thin.
- Build summary and reconciliation values with inspectable Excel formulas linked to the exported schedules where practical; use source values only where formulas would reduce clarity or reliability.
- Validate that all currency totals remain segregated and that wallet reconciliation differences equal 0.00 for representative datasets.
- Test workbook structure, transformed monetary values, transfer ledger legs, reconciliation formulas, control totals, data coverage, localization, download headers, and Settings interaction before implementation.
