# Accountant-Ready Excel Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings download that exports every non-deleted financial record to a localized, accountant-ready, reconciled Excel workbook.

**Architecture:** A server-only export feature will collect a stable RLS-protected snapshot, normalize it into audit schedules and wallet-ledger legs, and build a styled ExcelJS workbook. A thin locale-aware Route Handler will return the XLSX file, while a small Client Component in Settings handles progress, download, and localized errors.

**Tech Stack:** Next.js 16.4.5 App Router, React 19, TypeScript, Supabase/PostgREST, ExcelJS 4.4.0, Vitest, Testing Library, next-intl.

**Spec:** `docs/superpowers/specs/2026-11-05-polished-excel-export-design.md`

## Global Constraints

- Follow the installed Next.js 16.4.5 Route Handler and Server/Client Component documentation in `node_modules/next/dist/docs/`.
- Export only the signed-in user's RLS-visible records; include archived records and exclude soft-deleted records.
- Never add USD, LBP, and SYP together or silently convert them.
- USD uses two decimal places; LBP and SYP use whole ledger units.
- Localize every authored workbook label to the user's active `en` or `ar` locale; preserve user-entered text verbatim and use RTL worksheets for Arabic.
- Keep the workbook cash-based and do not label it as a double-entry ledger, trial balance, income statement, tax return, or GAAP/IFRS report.
- Read large tables in stable pages below PostgREST's 1,000-row default cap and fail closed on incomplete, duplicate, or malformed data.
- Generate the file on the server; never expose database credentials or raw internal operational tables to the browser.
- Use test-first red/green cycles for every production behavior.

## Review Focus

- Cashier-settlement expenses with same- and cross-currency change must create payer and change wallet legs that reconcile exactly to app wallet balances; pin this in Task 1.
- Same- and cross-currency transfers must produce two traceable wallet legs without combining currencies; pin this in Task 1.
- Empty accounts and individual empty schedules must still produce a valid localized workbook with headers and zero/blank controls rather than missing sheets; pin this in Task 3.
- Exports larger than 1,000 source rows must be complete and stable, and duplicate page boundaries must fail instead of double-counting; pin this in Task 2.
- Signed-out configured requests and workbook-generation failures must return no-store error responses without leaking data or stack details; pin this in Task 4.

---

### Task 1: Export model and accounting schedules

**Files:**
- Create: `src/features/export/model.ts`
- Create: `src/features/export/schedules.ts`
- Test: `src/features/export/schedules.test.ts`

**Interfaces:**
- Consumes: `Profile`, `Wallet`, `Category`, `Transaction`, `FixedExpense`, `Installment`, `Loan`, `PendingPayment`, `Currency`, and `CURRENCY_DECIMALS` from existing feature modules.
- Produces: `ExportData`, `BudgetRevision`, `PendingReceiptExport`, `WalletLedgerRow`, `WalletReconciliation`, `MonthlyActivityRow`, `BudgetActualRow`, `minorToMajor(minor, currency)`, and `buildExportSchedules(data)`.

- [ ] **Step 1: Write failing tests for wallet-ledger and reconciliation rules**

Add tests named:

- `creates one inflow or outflow leg for ordinary income, expense, and loan cash flows`
- `creates both transfer legs and keeps their currencies separate`
- `uses tender as payer outflow and adds every cashier-change wallet inflow`
- `reconciles opening balance plus ledger activity to each exported wallet balance`
- `retains archived wallets and source identifiers in schedules`

Use a synthetic dataset containing USD cents, whole LBP/SYP, a cross-currency transfer, and an expense with two change wallets. Assert exact minor-unit totals and a zero reconciliation difference.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test src/features/export/schedules.test.ts`

Expected: FAIL because `model.ts`, `schedules.ts`, and their exports do not exist.

- [ ] **Step 3: Implement the export types and wallet schedules**

In `model.ts`, define the immutable source snapshot and schedule row types. In `schedules.ts`, implement:

```ts
export function minorToMajor(minor: number, currency: Currency): number;
export function buildWalletLedger(data: ExportData): WalletLedgerRow[];
export function buildReconciliations(data: ExportData, ledger: readonly WalletLedgerRow[]): WalletReconciliation[];
```

Ledger rules must mirror `public.wallet_balances`: income and inbound loans are inflows; ordinary expenses use `settlement.tenderMinor ?? amountMinor` as payer outflow; outbound loans and transfer sources are outflows; transfer destinations and every settlement change are inflows.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm test src/features/export/schedules.test.ts`

Expected: PASS for all wallet-ledger and reconciliation cases.

- [ ] **Step 5: Write failing tests for monthly activity and budget actuals**

Add tests named:

- `groups monthly activity by month and currency without a combined currency total`
- `rolls budget revisions forward until the next revision or removal`
- `maps subcategory expenses to the parent budget category`
- `reports unavailable variance percent for a missing or zero budget`
- `rejects unsafe minor-unit values instead of rounding them`

- [ ] **Step 6: Run the focused test and verify RED**

Run: `pnpm test src/features/export/schedules.test.ts`

Expected: FAIL because monthly and budget schedule builders are not implemented.

- [ ] **Step 7: Implement the remaining schedule builders**

Add:

```ts
export function buildMonthlyActivity(data: ExportData): MonthlyActivityRow[];
export function buildBudgetActuals(data: ExportData): BudgetActualRow[];
export function buildExportSchedules(data: ExportData): ExportSchedules;
```

Monthly rows must use typed calendar months and separate operating income, operating expense, loan cash in/out, transfers in/out, and net wallet activity by currency. Budget actuals must expand effective budget revisions only for months with a budget or expense through the export cutoff, aggregate child-category expenses to their parent, and label over/under budget without inventing a percentage for a missing denominator.

- [ ] **Step 8: Run the focused test and verify GREEN**

Run: `pnpm test src/features/export/schedules.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit the model and schedule slice**

```bash
git add src/features/export/model.ts src/features/export/schedules.ts src/features/export/schedules.test.ts
git commit -m "feat: build accountant export schedules"
```

---

### Task 2: Complete RLS-protected export snapshot

**Files:**
- Create: `src/features/export/data.ts`
- Test: `src/features/export/data.test.ts`

**Interfaces:**
- Consumes: `ExportData` from Task 1; existing profile, wallet, category, fixed-expense, installment-cycle, loan, pending-payment, transaction mapping, demo-data, and Supabase server helpers.
- Produces: `readAllRowsById<T>()` for strict keyset paging and `getExportData(locale: "en" | "ar", exportedAt?: Date): Promise<ExportData>`.

- [ ] **Step 1: Write failing strict-pagination tests**

Add tests named:

- `reads every row across more than one thousand records using a stable id cursor`
- `fails closed when a page repeats an id`
- `fails closed when a page query reports an error`

The successful fixture must return 1,205 unique rows over 500-row pages.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test src/features/export/data.test.ts`

Expected: FAIL because `readAllRowsById` does not exist.

- [ ] **Step 3: Implement strict keyset paging**

Implement:

```ts
export async function readAllRowsById<T extends { id: string }>(
  load: (afterId: string | null, limit: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize?: number,
): Promise<T[]>;
```

Require ascending unique ids, request `pageSize + 1` only where needed by the concrete query, and throw `export_data_unavailable` for query errors, malformed pages, or duplicates.

- [ ] **Step 4: Run the pagination tests and verify GREEN**

Run: `pnpm test src/features/export/data.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing snapshot-collection tests**

Add dependency-injected tests named:

- `collects all accountant schedules and excludes deleted source rows`
- `includes archived master data and preserves the selected locale`
- `builds a complete demo snapshot when Supabase is not configured`
- `fails the whole export when any required source is unavailable`

- [ ] **Step 6: Run the focused test and verify RED**

Run: `pnpm test src/features/export/data.test.ts`

Expected: FAIL because `getExportData` and the snapshot collector are not implemented.

- [ ] **Step 7: Implement snapshot collection**

Query active transactions with expense items and cashier changes, all wallet/category masters, all budget revisions, fixed expenses, installment snapshot/history, non-deleted loans, non-deleted receivables, and receipt links. Reuse existing domain parsers wherever they retain all required fields. Use `Promise.all` only for independent sources, filter soft-deleted rows in the database query, and keep archived rows. For unconfigured mode, assemble the same `ExportData` shape from demo sources.

- [ ] **Step 8: Run the focused test and verify GREEN**

Run: `pnpm test src/features/export/data.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit the data slice**

```bash
git add src/features/export/data.ts src/features/export/data.test.ts
git commit -m "feat: collect complete export data"
```

---

### Task 3: Localized accountant-ready Excel workbook

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/features/export/labels.ts`
- Create: `src/features/export/workbook.ts`
- Test: `src/features/export/workbook.test.ts`

**Interfaces:**
- Consumes: `ExportData` and `buildExportSchedules(data)` from Tasks 1–2.
- Produces: `getExportLabels(locale)`, `buildExportWorkbook(data): ExcelJS.Workbook`, and `writeExportWorkbook(data): Promise<Buffer>`.

- [ ] **Step 1: Add the workbook dependency**

Run: `pnpm add exceljs@4.4.0`

Expected: `package.json` and `pnpm-lock.yaml` record ExcelJS 4.4.0.

- [ ] **Step 2: Write the failing workbook-structure tests**

Add tests named:

- `creates every accountant workpaper in English with stable Excel table names`
- `creates every workpaper in Arabic with translated labels and RTL views`
- `keeps all nineteen sheets with headers when every source schedule is empty`
- `stores dates and amounts as typed Excel values using currency precision`

Assert the exact localized sheet set: Cover, Financial Summary, Reconciliation, Monthly Activity, Wallet Ledger, Budget vs Actual, Transactions, Expense Items, Wallets, Categories, Salary, Fixed Expenses, Installments, Installment Payments, Loans, Loan Payments, Receivables, Receipts, and Checks & Definitions, with the approved Arabic equivalents.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `pnpm test src/features/export/workbook.test.ts`

Expected: FAIL because labels and workbook builder do not exist.

- [ ] **Step 4: Implement localized labels and base workbook structure**

Implement locale dictionaries for sheet names, headings, status text, definitions, limitations, and column labels. Create all nineteen worksheets in the fixed order, set workbook metadata and recalculation mode, apply RTL views for Arabic, preserve user text, hide gridlines, and add headers even when schedules are empty.

- [ ] **Step 5: Run the structure tests and verify GREEN**

Run: `pnpm test src/features/export/workbook.test.ts`

Expected: PASS for structure, localization, empty schedules, dates, and money values.

- [ ] **Step 6: Write failing accounting-format and control tests**

Add tests named:

- `links reconciliation inflows and outflows to the wallet ledger and shows a zero difference result`
- `links summary totals by currency without a combined currency formula`
- `adds control counts and source totals to Checks and Definitions`
- `uses accounting formats, frozen detail headers, autofilters, and exception-only reconciliation formatting`
- `writes a readable xlsx buffer that ExcelJS can load again`

- [ ] **Step 7: Run the focused test and verify RED**

Run: `pnpm test src/features/export/workbook.test.ts`

Expected: FAIL because formulas, control totals, tables, and finance styling are incomplete.

- [ ] **Step 8: Implement the accountant-ready workbook**

Use invariant ASCII Excel table names and locale-specific visible labels. Populate:

- Cover with cutoff, export timestamp, source/scope, cash-basis statement, currency rules, and limitations.
- Financial Summary with separate USD/LBP/SYP sections and linked results.
- Reconciliation with inspectable `SUMIFS` formulas against `WalletLedgerTable`, cached results, and a difference check.
- Monthly Activity and Budget vs Actual with typed periods, totals, variance formulas, and meaningful denominator handling.
- Detail/support schedules with filters, frozen headers, source identifiers, readable wallet/category names, and control totals.
- Checks & Definitions with record counts, same-currency source totals, reconciliation differences to two decimals, sign conventions, and field definitions.

Apply restrained finance styling: Aptos/Arial fallback, compact titles, dark headers with white text, hidden gridlines, accounting negatives in parentheses, dash zeros, 2 decimals for USD, 0 for LBP/SYP, thin structural borders, no decorative cell grid, and conditional red formatting only for non-zero reconciliation differences.

- [ ] **Step 9: Run workbook tests and verify GREEN**

Run: `pnpm test src/features/export/workbook.test.ts`

Expected: PASS and the serialized buffer reloads with all nineteen sheets.

- [ ] **Step 10: Commit the workbook slice**

```bash
git add package.json pnpm-lock.yaml src/features/export/labels.ts src/features/export/workbook.ts src/features/export/workbook.test.ts
git commit -m "feat: generate localized accountant workbook"
```

---

### Task 4: Secure XLSX download route

**Files:**
- Create: `src/app/[locale]/(app)/settings/export/route.ts`
- Create: `src/app/[locale]/(app)/settings/export/route.test.ts`

**Interfaces:**
- Consumes: `getUserId()`, `supabaseConfigured()`, `getExportData(locale)`, and `writeExportWorkbook(data)`.
- Produces: `GET(request, context)` returning an XLSX attachment or a safe no-store error response.

- [ ] **Step 1: Write failing route tests**

Add tests named:

- `downloads the selected-locale workbook with xlsx headers and no-store caching`
- `allows the unconfigured demo export without a session`
- `returns 401 with no-store headers when Supabase is configured and the user is signed out`
- `returns a generic 500 response with no-store headers when data collection or generation fails`

Assert `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, an ASCII filename `budget-export-YYYY-MM-DD.xlsx`, and no stack/error detail in the 500 body.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test 'src/app/[locale]/(app)/settings/export/route.test.ts'`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the Route Handler**

Follow the installed Next.js Route Handler API. Validate `locale` as `en | ar`, require a user only when Supabase is configured, generate the buffer server-side, and return private/no-store headers on every response. Use a `Uint8Array` response body if required by the Web `Response` type.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm test 'src/app/[locale]/(app)/settings/export/route.test.ts'`

Expected: PASS.

- [ ] **Step 5: Commit the route slice**

```bash
git add 'src/app/[locale]/(app)/settings/export/route.ts' 'src/app/[locale]/(app)/settings/export/route.test.ts'
git commit -m "feat: serve secure excel exports"
```

---

### Task 5: Settings export experience

**Files:**
- Create: `src/app/[locale]/(app)/settings/export-button.tsx`
- Create: `src/app/[locale]/(app)/settings/export-button.test.tsx`
- Modify: `src/app/[locale]/(app)/settings/settings-form.tsx`
- Modify: `src/messages/en.json`
- Modify: `src/messages/ar.json`
- Modify: `src/messages/messages.test.ts`

**Interfaces:**
- Consumes: `useLocale()`, localized `Settings` messages, the existing `Button`, and `GET /{locale}/settings/export` from Task 4.
- Produces: `ExportButton` and an accountant-ready export section in Settings.

- [ ] **Step 1: Write failing interaction and translation tests**

Add tests named:

- `downloads the workbook using the active locale and server filename`
- `disables the button and announces progress while the export is generated`
- `shows a localized retry message when the export response fails`
- `revokes the temporary object URL after starting the download`
- `keeps the English and Arabic Settings message trees in sync`

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm test 'src/app/[locale]/(app)/settings/export-button.test.tsx' src/messages/messages.test.ts`

Expected: FAIL because the component and new translation keys do not exist.

- [ ] **Step 3: Implement the Settings export section**

Create a focused Client Component that fetches `/${locale}/settings/export`, reads the server filename, creates a temporary object URL, programmatically clicks a download link, and always revokes the URL. Add a Settings section with a spreadsheet icon, accountant-ready description, busy label, download button, and accessible status/error text. Keep profile save behavior unchanged.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `pnpm test 'src/app/[locale]/(app)/settings/export-button.test.tsx' src/messages/messages.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the Settings slice**

```bash
git add 'src/app/[locale]/(app)/settings/export-button.tsx' 'src/app/[locale]/(app)/settings/export-button.test.tsx' 'src/app/[locale]/(app)/settings/settings-form.tsx' src/messages/en.json src/messages/ar.json src/messages/messages.test.ts
git commit -m "feat: add settings excel export"
```

---

### Task 6: Full verification and delivery check

**Files:**
- Modify if required by findings: files from Tasks 1–5 only

**Interfaces:**
- Consumes: the complete export feature.
- Produces: a verified implementation with no known test, type, lint, build, localization, or workbook-integrity failures.

- [ ] **Step 1: Run the complete unit suite**

Run: `pnpm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run type checking**

Run: `pnpm typecheck`

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`

Expected: exit 0 with no ESLint errors.

- [ ] **Step 4: Run the production build**

Run: `pnpm build`

Expected: exit 0 and the localized settings export route is included successfully.

- [ ] **Step 5: Perform a workbook smoke check**

Generate English and Arabic demo workbooks through `writeExportWorkbook`, reload each buffer with ExcelJS, and verify nineteen sheets, RTL on Arabic sheets, zero reconciliation differences, typed dates/amounts, and non-empty Checks & Definitions.

- [ ] **Step 6: Review the diff against the approved design**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only planned export, translation, dependency, test, and documentation files are changed.

- [ ] **Step 7: Commit any verification-only corrections**

```bash
git add <only-corrected-planned-files>
git commit -m "fix: finalize accountant excel export"
```
