# Loans with Percentage Fees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execution update:** the owner authorized implementation and a final combined commit/push. The parent orchestrator owns that final commit/push; this session never stages or commits. This session's current lease is Phase A (new loan domain/UI/routes, reserved loan migrations/tests) only; shared application integration is released separately. Do not create further chats or delegate without authorization.

**Goal:** Track money borrowed and lent, a precisely calculated one-time percentage fee, wallet disbursement and partial repayments without counting principal as income or spending.

**Architecture:** Introduce a separate `loans` aggregate and a dedicated `loan` transaction kind. One loan event is one wallet transaction containing its principal/fee split; database functions, row locks and integrity constraints keep terms, progress and wallet movements consistent. A shared reporting projection exposes only realized fees as expense/income, while existing installment purchase payments retain their existing expense semantics.

**Tech Stack:** Existing Next.js **16.4.5**, React 19, Supabase Postgres/Auth/RLS, TypeScript, zod 4, next-intl, existing Base UI sheets and Encaustic tile tokens; no new runtime dependency proposed.

**Spec:** This file's design below implements owner item 7. **Owner clarification received through the orchestrator: BOTH borrowed and lent loans, with a ONE-TIME percentage fee, are confirmed scope.** Remaining detailed semantics are proposals. Read alongside `PRODUCT.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/MOBILE-UX.md`, `DESIGN.md`, `.impeccable/surfaces/src-app-locale.md` and `docs/plans/round-3/README.md`. Loans being out of original v1 is superseded by this new request; do not treat unconfirmed defaults as owner-approved.

## Global constraints

- Phase A lease: new `src/features/loans/*`, `src/components/loans/*`, loan route files, the two reserved loan migrations/tests, and this plan. Shared money, transaction/UI/actions, wallet/category actions, shared catalogs/demo and root docs remain parent-coordinated integration work.
- Mobile first at 390px; final checks at **320, 390, 430, 768, 1280px** in EN/AR, light/dark. Logical RTL utilities, `<Amount>`/`<bdi>` money and names, inputs at least 16px, targets at least 44px, safe-area footers and `min-h-dvh`.
- Reads in Server Components; writes in authenticated Server Actions with zod and `ActionResult`. Use the publishable key/user session, never an app-imported secret key.
- Integer minor units only, `MAX_MINOR = 1_000_000_000_000_000` per money value; exact fixed-point percentage arithmetic; currencies never mixed. Consume item 6's shared currency definition, precision metadata and per-currency accumulators, including SYP if accepted there.
- Append-only migrations with SQL tests. **The orchestrator assigns both migration timestamps** after final implementation ordering; do not reuse numbers from round 2 or edit existing migrations.
- All user-visible copy ships in `src/messages/en.json` and `src/messages/ar.json` together; preserve demo mode with synthetic fixtures and preview-only writes.
- Future UI work starts with the project's `impeccable` skill and a reviewable 390px EN/AR mockup before full UI implementation. This plan does not create a mockup or a second spec file.
- Installed Next guides inspected: `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`, `03-layouts-and-pages.md`, and `01-app/03-api-reference/04-functions/revalidatePath.md`. Keep module-level `"use server"`, authenticate each externally callable action, and preserve the current `revalidatePath("/", "layout")` contract unless the coordinated performance work supplies a tested narrower invalidation helper. Do not add experimental offline APIs or host-specific caching.

## Current implementation findings

| Current file/interface | Consequence for loans |
| --- | --- |
| `src/features/installments/schema.ts`: `InstallmentInput`, `Installment`, `withProgress(base, payments, monthStart)`, `dueThisMonth(i)` | A purchase total, optional monthly amount and historical paid amount. No principal, percentage, direction or disbursement. `paidThisMonthMinor` currently has a lower date bound only; do not copy that into loan reporting. |
| `src/features/installments/actions.ts`: `createInstallment`, `updateInstallment`, `deleteInstallment`, `payInstallment` | Payments are ordinary `expense` rows with `source='installment'`, `installment_id`, purchase category and note. Deleting the installment leaves payments via `ON DELETE SET NULL`. This is unsuitable for a loan audit trail. |
| `supabase/migrations/20261110000100_installments.sql`: installment integrity/progress and payment trigger | Locks the installment before checking remaining balance. Reuse the locking idea, not its expense accounting or nullable historical association. |
| `src/features/fixed/summary.ts`: `summarizeFixed(items, walletById, salary, installments=[])` | Adds installment monthly dues to fixed needs and subtracts these from salary in its currency. A loan's whole outstanding balance must not be added here. |
| `supabase/migrations/20261109000100_transfers.sql`: transaction shape/integrity and `wallet_balances` | Stored kinds are income/expense/transfer. Balance uses income positive and **every other source row negative**. A borrowed disbursement or received repayment would be wrong without an explicit new branch. |
| `src/features/transactions/schema.ts`, `queries.ts`, `group.ts` | `RowKind`, filters, query columns and `signedMinor` know three kinds. Day totals exclude transfers but otherwise use gross amounts. Loan fee and cash-flow amounts must be distinguished. |
| `src/components/transactions/{transaction-row,detail-sheet,activity-view}.tsx`, `src/components/shell/composer.tsx` | Activity labels missing categories as blank and routes generic edit/delete/duplicate to ordinary transactions. Loan events need their own labels, links and controlled reversal flow. |
| `src/features/transactions/actions.ts` | Generic update/delete/restore currently accept any visible transaction ID; hiding UI buttons is insufficient. Guard managed loan rows and enforce equivalent SQL invariants against direct client requests. |
| `supabase/migrations/20261110000200_budgets.sql`: `month_category_spend(date)`; `src/features/budgets/queries.ts` | Spending sums whole ordinary expense rows, with subcategory rollup. Use fee-only reporting for loans. There is **no implemented `month_summary` RPC or Reports route** despite architecture intentions; do not invent a dependency on one. Item 2 proposes descriptive expense children while keeping parent-only reporting, not a new Reports subsystem. |
| `src/lib/money.ts` | `Currency='USD'|'LBP'`, exact parsing and `BigInt` conversion precedent. Percentage multiplication must use `BigInt`; safe input integers do not imply their product is safe. |
| `src/features/wallets/{schema,actions,queries}.ts` | Wallet balances come from SQL; `deleteWallet` checks transactions and fixed references but not future loans. Currency locking currently looks at transaction history only, missing a record-only loan's wallet reference. |
| `src/lib/supabase/action.ts` | `actionClient()` handles auth/demo; existing `ActionError` includes `exceedsRemaining`, `inUse`, `invalid`, `notConfigured`, `failed`. Add narrow loan lifecycle errors as needed, with bilingual mapping. Client is currently untyped (`SupabaseClient`); generated types are planned, not already integrated. |
| Home route and `home-view.tsx`; app data provider; `e2e/installments.spec.ts` | Loan data need not enter the global provider or the Home critical query bundle. Use a Loans destination linked from Wallets; existing demo e2e checks cannot establish database correctness. |

## Proposed design/spec — defaults for consolidation

### Scope and alternatives

**Confirmed:** support both **I borrowed** (`borrowed`) and **I lent** (`lent`), with a one-time percentage fee. **Recommended remaining defaults:** separate loan records, fee added to the debt, principal-first allocation, manual repayments and no schedule in the first release. This covers both directions with one balance invariant and avoids changing purchase installment semantics.

Alternatives considered:

1. Extend installments with percentages: less new UI, but borrowing inflows and principal repayments would be misreported as ordinary income/expense; removing a loan would detach financial history. Reject as the default. Reuse only `SheetShell`, `Amount`, `TileBar`, wallet/category selectors and established form patterns.
2. Separate principal transfer plus ordinary fee expense/income rows: compatible with ordinary reports, but requires multirow event grouping, atomic reversal, and a new one-sided principal transaction kind anyway. Prefer a single event row with a fee split for the minimal implementation. Items 2/4 retain parent purchase cost as the reporting amount; extend that contract with a fee-only loan projection, not another ledger or a sum of expense children/tender.
3. Borrowed-only is excluded by the owner's clarification. Recurring interest, daily accrual, compounding and fees charged again on each repayment are excluded by the confirmed **one-time** scope. Fee withholding at origination remains an alternative to the proposed additive fee; it would change the opening wallet amount and fee-recognition timing and requires an explicit design revision before build. Automatic debits are out of this slice.

### Terms, exact percentage and opening state

- Fields: descriptive name/counterparty (one 1–60-character label, not a contacts system), direction, principal, one-time fee percentage, default wallet, fee category and opening date. Optional note is not needed initially; a transaction note snapshots the loan name.
- Store percentage as integer **basis points**: `feeBps` from 0 through 10,000 inclusive; `7.25% = 725`. Proposed UI precision: two decimal percentage places, no scientific notation, no grouping separators, no negative values and no silently rounded extra decimals. Accept Latin/Arabic-Indic digits and `.`/`٫`. A displayed percentage sign is outside the input. The proposed 100% maximum is a product input bound, not a legal or financial rule; revise only explicitly.
- `feeMinor = floor((BigInt(principalMinor) * BigInt(feeBps) + 5000n) / 10000n)`; round half up once to the currency's smallest unit. `totalDueMinor = principalMinor + feeMinor`. Reject when principal, fee or total exceed `MAX_MINOR`; mirror calculation using Postgres `numeric` intermediates (the product can exceed SQL `bigint`) and cast only bounded results to `bigint`.
- Show **Principal / One-time fee (x%) / Total to repay** for borrowed loans; use corresponding receive language for lent loans. Show the rounded fee before Save, including a valid zero fee. Never label this APR or periodic interest.
- Creation has an explicit, unselected required choice: **Record principal moving now** (`new`) or **Loan already existed** (`existing`). Explain the exact wallet effect before submission; do not auto-infer from the date.
- `new`: one principal-only disbursement on the supplied date; borrowed credits the selected wallet, lent debits it. No income/expense or budget impact. Historical-paid inputs are zero. No upfront fee deduction.
- `existing`: no disbursement transaction and no wallet balance change. Store `principalPaidBeforeMinor` and `feePaidBeforeMinor` explicitly, default zero; each must be between zero and its corresponding contractual component. These opening balances affect progress but create **no fake Activity, fee income/expense or budget history**. Copy explains current wallet balances should already reflect the old cash movements. Opening date is the start of tracked history; later payments cannot precede it. Import of detailed old events is out of scope.
- Derive immutable currency from the active selected wallet, including item 6's accepted currencies. Payments can use any active wallet of exactly that currency. No conversion/rate application inside a loan, even when a reference rate exists. A user can record a separate ordinary exchange first.
- Use a real-calendar date validator shared by loan forms/actions; reject impossible dates, dates before 2000-01-01 and dates after today in the saved profile timezone. SQL repeats the date bounds using the authenticated user's profile timezone, not client locale. Existing loans with pre-2000 origin may use their tracking opening date; full historical import is excluded.

### Repayment and accounting contract

For each payment `A`, using remaining components immediately before that event:

`principalPart = min(A, principalRemaining)`; `feePart = A - principalPart`.

Reject `A <= 0` or `A > principalRemaining + feeRemaining`. Store the split at posting; do not recalculate historical fee allocation when reading. A fee-first or proportional policy can be selected instead before build, but must change examples/tests explicitly.

| Event | Wallet movement | Expense/income/budget treatment |
| --- | --- | --- |
| Borrowed principal disbursed | `+principal` | None |
| Lent principal disbursed | `-principal` | None |
| Borrowed repayment | `-(principalPart + feePart)` | Only `feePart` is expense, against selected expense fee category |
| Lent repayment received | `+(principalPart + feePart)` | Only `feePart` is income, against selected income fee category |
| Opening paid-before balances | None | None |
| Void/restore eligible event | Reverse/reapply the same saved split | Remove/reapply that fee once in its original reporting period |

Example: principal **$1,000.00**, fee **7.25%** = **$72.50**, total **$1,072.50**. First repayment **$400.00**: principal 40,000 cents, fee 0, remaining 67,250. Second **$650.00**: principal 60,000, fee 5,000, remaining fee 2,250. Last **$22.50** settles the loan. A borrowed loan reports fee expense **$72.50** total, a lent loan fee income **$72.50**; neither reports $1,000 principal as earned/spent. At 10% of **5 LBP** the fee rounds to **1 LBP**. Item 6 currently proposes SYP precision 2: under that proposal **SYP 12.50** at **7.25%** gives a **SYP 0.91** fee and **SYP 13.41** total. Consume its finalized precision/denomination contract rather than independently defining SYP units here.

- Loan list/detail show original principal, contractual fee, total due, historical opening paid, in-app principal/fee paid, remaining components and full payment history (date, wallet, split). Totals separate **I owe** from **Owed to me**, and separate every currency; never net the two or call wallet totals net worth.
- Budget/category/month reporting uses a single `reporting_entries` security-invoker view owned by this plan's Task 4, with `transaction_id, user_id, occurred_on, currency, category_id, kind, amount_minor`. Item 2 does not introduce this view. Ordinary income/expense retain their existing parent cost amount, independent of descriptive breakdowns or cashier tender/change; a loan repayment contributes only a positive fee amount with derived income/expense kind; principal-only and transfer events contribute no entry. Exclude soft-deleted rows. `month_category_spend` consumes this projection and preserves existing category parent rollup.
- The Activity row shows **full signed wallet movement** and a clear loan label. Day headers retain their existing income-minus-spending meaning: include only signed fee for a loan, never gross principal. Loan detail explains the split so this difference is intelligible. All/Loans filters show loan events; expense/income category detail includes fee-bearing loan repayments exactly once through the reporting projection, even though their stored `kind` is `loan`. Pagination remains one cursor per event, not per component.
- Do not add loan principal to `summarizeFixed`, salary-after-fixed, budgets, item 5's installment due tracker or monthly expense summaries. No automatic payment, reset or fee recalculation when salary is received. A future scheduled loan payment can integrate as a distinct cash commitment, not as a second expense.
- Aggregate by the currency registry established by item 6 (`Record<Currency, ...>`), including empty states. Use exact checked aggregation; if a displayed number would exceed the supported safe range, return a localized section error rather than a rounded JS result. Individual history remains accessible.

### Edit, void, delete and retry policy

- Financial terms, direction, currency, creation mode, opening date and opening-paid amounts are immutable after creation. Name, same-currency default wallet and valid fee category can be updated; each transaction retains its original wallet, name snapshot, category and split. Corrections of terms use cancel/recreate when permitted.
- Repayment amounts/dates/wallets cannot be edited in place. **Void the latest live repayment, then re-enter.** Earlier payments with later live repayments cannot be voided because that could change principal-first allocation. Explain this before confirmation. This is a deliberate minimal correction policy, not an invitation to silently reallocate old fees.
- Assign monotonic per-loan `loan_event_seq` under the loan lock (disbursement is 0, repayment starts at 1). New payment dates cannot precede the latest live repayment date. Same-day events use sequence order. Stored voided events remain in history. Restoring a voided repayment is allowed only with no later live repayment, the loan still live, its original allocation still matching current balances, and no overpayment. Report restore failures visibly; do not ignore `ActionResult` as the generic Undo currently does.
- `cancelLoan` soft-deletes a loan **only with no live repayments**; for `new`, atomically soft-delete its disbursement too, reversing principal. Explain the wallet reversal. For `existing`, cancel only the tracking record with no wallet adjustment. Keep all rows and foreign keys; no hard-delete path and no `ON DELETE SET NULL`. Canceled events cannot be restored through generic transaction Undo; correction is a new explicit loan.
- Fully repaid loans can be archived/collapsed and reopened for history; active debts cannot be hidden by archive. Voiding a settlement payment atomically clears the loan's archive flag. No write-off/forgiveness/refinancing UI in this slice.
- Generic transaction edit, duplicate, delete and restore must reject loan rows (`managedTransaction`); loan detail routes to loan-specific actions. Enforce the lifecycle in SQL too, so direct Supabase calls cannot detach a loan, change its direction or convert a loan row to an ordinary expense.
- Create/payment submissions carry client-generated `requestId` reused for retries. Unique per-user keys return the original result on identical replay and reject changed payloads. A lost response must not produce another disbursement/payment. Deletion/restoration/archive transitions are idempotent under the same lock.

### Mobile surface proposal

- Add a **Loans** link in Wallets (reachable in one additional tap); a dedicated `/[locale]/loans` page leaves the current bottom navigation and Home first viewport intact. Loans data stay on that route, not global `AppDataProvider`.
- Page leads with separate “I owe” / “Owed to me” per-currency totals, active rows and a collapsed settled group; canceled history is available in detail/history filtering. A clear Add loan button opens the responsive shared sheet.
- Form: direction, name, principal with currency wallet, one-time percentage, computed fee/total, required movement/existing choice, relevant historical-paid fields, date and fee category. Submission summary states “Add [principal] to [wallet]” or “Take [principal] from [wallet]”, or “No wallet movement”. Category kind switches with direction; a missing active wallet/category gets a useful action/error rather than an impossible Save.
- Detail sheet contains terms, progress, immutable history and a primary “Record repayment”/“Record money received”. Payment sheet selects only active same-currency wallets and previews principal/fee allocation and remaining balance. No red overdue styling or due-date system is introduced.
- Use `SheetShell`, `Select`, `TextField`, `ConfirmSheet`, `Button`, `TileBar` and `Amount`; keep all amounts untruncated and wrap/stack long rows, including Arabic mixed-script names. Focus restoration, pending disabled Save, optimistic rollback and stable row heights follow current app patterns. Server remains authoritative if two tabs race.

## Data and interface contract

### Proposed SQL shape

Two append-only migrations: an orchestrator-assigned `<timestamp>_loan_kind.sql` adding `'loan'` to `public.txn_kind`, then a later assigned `<timestamp>_loans.sql` using it. Follow the existing separate transfer enum migration pattern; never add and consume the enum value in one migration transaction.

`public.loans`:

- `id`, `user_id default auth.uid()` FK auth users, `request_id`, `name`, `direction text check borrowed/lent`, `currency public.currency`, `wallet_id` FK wallets, `fee_category_id` FK categories. New history/reference FKs use `ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED`, preserving associations while permitting the whole account's auth-user cleanup to finish atomically; no cascading deletion from a wallet/category and no SET NULL.
- `principal_minor bigint`, `fee_bps integer`, computed-and-persisted `fee_minor bigint`, `total_due_minor bigint`, `creation_mode text check new/existing`, `opened_on date`, `principal_paid_before_minor bigint`, `fee_paid_before_minor bigint`.
- `created_at`, `archived_at`, `deleted_at`; unique `(user_id, request_id)`; user/list ordering index. Do not store mutable remaining amounts: derive under lock from opening amounts plus live payment components.

Extend `public.transactions` with nullable `loan_id` FK loans (`ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED`), `loan_event text check disbursement/repayment`, `loan_flow text check in/out`, `loan_principal_minor bigint`, `loan_fee_minor bigint`, `loan_event_seq integer`, `loan_request_id uuid`.

- For kind `loan`, require all metadata, `source='loan'`, `installment_id is null`, no transfer destination, nonnegative component amounts and `amount_minor = loan_principal_minor + loan_fee_minor > 0`. Principal and flow come from DB rules, not client authority. Disbursement has no category and zero fee; repayment snapshots the loan's valid direction-matching fee category even when its fee part is zero. Never permit a loan row to also be salary/fixed/cashier/purchase-item data.
- For every other kind, require all loan metadata null. Preserve the latest transaction-shape constraints from items 2/4; replace current `transactions_kind_shape`, `transactions_integrity` and source constraint by extension, never by reverting their changes.
- Unique `(loan_id, loan_event_seq)` and one disbursement per loan (including soft-deleted events); unique `(user_id, loan_request_id)` for loan events; active history index `(loan_id, loan_event_seq)`.
- `loans_integrity` validates ownership/active reference rules, copies currency, computes bounded fee/total, protects terms/user_id and locks lifecycle changes. `transactions_loan_check` locks the loan, verifies same tenant/currency/date/category/lifecycle, assigns sequence/flow/split, prevents overpayment and restricts updates to validated void/restore transitions. Nonloan-to-loan and loan-to-nonloan updates are forbidden. Naming/order must be coordinated with existing triggers; the common transaction integrity function must explicitly branch on `loan` before ordinary category kind validation.
- A deferred constraint trigger on affected loans/transactions verifies **exactly one live disbursement for a live `new` loan**, no disbursement for `existing`, and none live for canceled loans. It must also protect against direct insert/update outside the intended RPC; app-only sequencing is insufficient.
- Every operation touching payments, cancel, restore or terms locks the same loan row first; lock wallet/reference rows consistently when validating active status to prevent archive/currency races. Decide a single lock order and cover concurrent wallet archive/currency-change attempts. Do not lock transaction first in generic code then loan in reverse order.
- `loan_progress` view uses `security_invoker=true`; returns contractual/opening amounts, per-component paid/remaining and totals. Preserve RLS on both loan and transaction inputs; joins cannot expose names/amounts from foreign tenants. Amount sums use wide SQL intermediates and safe API decoding.
- RLS on loans select/insert/update is `user_id = (select auth.uid())`, WITH CHECK on writes; no hard-delete policy. Existing transactions RLS remains. Functions use `security invoker`, `set search_path=''`, qualified relation names and authenticated-only EXECUTE (revoke PUBLIC/anon); reject absent auth. Trigger invariants must make direct writes safe. If implementation cannot enforce the aggregate with invoker functions, stop and design a narrowly scoped authorized RPC boundary; do not casually introduce a privileged definer or rely on a spoofable custom session setting.
- Replace wallet balance logic to handle `loan_flow` explicitly; lock wallet currency when any loan references it, including record-only loans without transactions. Extend `deleteWallet`/category-management guards to return `inUse` for loan references; never orphan them. Account deletion still cascades ownership cleanup consistently with existing auth-user semantics; test it rather than weakening tenant keys.

### Proposed TypeScript interfaces

Create `src/features/loans/schema.ts` with zod input schemas and these shared public shapes (all money fields are bounded safe integer minor units; all IDs UUIDs):

```ts
type LoanDirection = 'borrowed' | 'lent';
type LoanCreateInput = {
  requestId: string; name: string; direction: LoanDirection;
  principalMinor: number; feeBps: number; walletId: string; feeCategoryId: string;
  openedOn: string; creationMode: 'new' | 'existing';
  principalPaidBeforeMinor: number; feePaidBeforeMinor: number;
};
type LoanEditInput = { name: string; walletId: string; feeCategoryId: string };
type LoanPaymentInput = {
  requestId: string; loanId: string; walletId: string;
  amountMinor: number; occurredOn: string;
};
type LoanEvent = {
  transactionId: string; loanId: string; event: 'disbursement' | 'repayment';
  flow: 'in' | 'out'; sequence: number; walletId: string; occurredOn: string;
  amountMinor: number; principalMinor: number; feeMinor: number;
  categoryId: string | null; deletedAt: string | null;
};
type Loan = {
  id: string; name: string; direction: LoanDirection; currency: Currency;
  walletId: string; feeCategoryId: string; openedOn: string;
  creationMode: 'new' | 'existing'; principalMinor: number; feeBps: number;
  feeMinor: number; totalDueMinor: number;
  principalPaidBeforeMinor: number; feePaidBeforeMinor: number;
  principalPaidMinor: number; feePaidMinor: number;
  principalRemainingMinor: number; feeRemainingMinor: number; remainingMinor: number;
  archivedAt: string | null; deletedAt: string | null; events: LoanEvent[];
};
```

- `src/lib/money.ts`: `parsePercentBps(text: string): number | null`, `calculateLoanFee(principalMinor: number, feeBps: number): { feeMinor: number; totalDueMinor: number } | null`; no floating percentage parse or money conversion. Keep normalization changes local so item 8's numeric deletion fix is not undone.
- `src/features/loans/calculations.ts`: `allocateRepayment(amountMinor: number, principalRemainingMinor: number, feeRemainingMinor: number): { principalMinor: number; feeMinor: number } | null`; `summarizeLoans(loans: readonly Loan[]): Record<Currency, { owedMinor: number; receivableMinor: number }> | null` (null denotes unsupported aggregate magnitude). Contract matches SQL and excludes canceled/archived zero balances. Consume item 6's proposed `CURRENCIES`, derived `Currency`, `CURRENCY_DECIMALS` and `emptyCurrencyTotals()` interfaces; do not duplicate their registry or denomination decisions.
- `src/features/loans/actions.ts`: `createLoan(input: LoanCreateInput): Promise<ActionResult<{ id: string }>>`, `updateLoan(id: string, input: LoanEditInput): Promise<ActionResult>`, `recordLoanPayment(input: LoanPaymentInput): Promise<ActionResult<{ id: string }>>`, `voidLoanPayment(transactionId: string): Promise<ActionResult>`, `restoreLoanPayment(transactionId: string): Promise<ActionResult>`, `cancelLoan(id: string): Promise<ActionResult>`, `setLoanArchived(id: string, archived: boolean): Promise<ActionResult>`.
- Each action wraps one corresponding SQL RPC: `create_loan(p_input jsonb)` and `record_loan_payment(p_input jsonb)` return TABLE `(id uuid)`; `update_loan(p_id uuid,p_input jsonb)`, `void_loan_payment(p_transaction_id uuid)`, `restore_loan_payment(p_transaction_id uuid)`, `cancel_loan(p_id uuid)`, `set_loan_archived(p_id uuid,p_archived boolean)` return void. JSON keys use the camelCase fields above. SQL validates JSON types/bounds too. Use stable prefixed error identifiers mapped to `invalid`, `exceedsRemaining`, `inUse`, `loanClosed`, `paymentOrder`, `termsLocked`, `managedTransaction`, `failed`; never expose raw DB detail to UI.
- `src/features/loans/queries.ts`: `getLoans(): Promise<Loan[]>`, server-only, synthetic `demoLoans()` when unconfigured. Read loans/progress plus batched event history, not an event query per loan; preserve canceled/voided history as well as active totals. Query failure must render a section error/retry state rather than masquerading as “no loans”.
- `Transaction` gains `'loan'` in `RowKind` and a required `loan: Pick<LoanEvent, 'loanId' | 'event' | 'flow' | 'sequence' | 'principalMinor' | 'feeMinor'> | null`. Add database fields to transaction query mapping and update all existing fixture constructors with null. `signedMinor` gains a loan-flow branch producing the gross signed loan movement; retain item 4's existing expense-cost semantics (do not replace an expense's cost with cashier tender). A separate `reportingMinor(t: Transaction): number` yields ordinary signed amount / loan signed fee / transfer zero. Add loan filter and fee-aware expense/income predicate; preserve keyset sort and `limit+1` behavior. Preserve item 2's `revision`, `items` and expected-revision interfaces; loan mutations remain their separate RPCs.

## File map and shared ownership

**New focused feature files:** `src/features/loans/{schema,calculations,actions,queries}.ts`, `schema.test.ts`, `calculations.test.ts`, `actions.test.ts`; `src/components/loans/{loans-view,loan-sheet,loan-detail-sheet,loan-payment-sheet}.tsx`; `src/app/[locale]/(app)/loans/{page,loading}.tsx`; `supabase/tests/loans.test.sql`, `supabase/tests/loans-concurrency.test.mjs`; `e2e/loans.spec.ts`; the two assigned migration files above.

**Modify shared current files:** `src/lib/money.ts` and `money.test.ts`; `src/lib/supabase/action.ts`; `src/features/transactions/{schema,queries,actions,group}.ts` and `group.test.ts`; `src/components/transactions/{transaction-row,detail-sheet,activity-view}.tsx`; `src/components/add/transaction-sheet.tsx` (reject a loan as a generic edit/duplicate initial value); `src/components/shell/composer.tsx`; `src/components/wallets/wallets-view.tsx`; `src/features/wallets/actions.ts`; `src/lib/demo-data.ts`; both message files; `supabase/tests/{isolation,budgets}.test.sql`; generated `src/lib/supabase/database.types.ts` when the coordinated typed-client work lands. Update `PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/MOBILE-UX.md`, `docs/PLAN.md` only during future implementation.

**Coordination:** item 1 owns category archive/delete/lookup behavior; fee categories must survive history and be selectable appropriately. Item 2 owns descriptive `expense_items`, parent-only aggregation and `save_transaction`/`revision`: loan fee reporting must not sum its children, rename its RPC or discard its revision guards. This plan's Task 4 owns the new fee reporting projection unless the orchestrator assigns one shared owner; future Reports/drilldowns consume it. Item 4 owns transaction settlement shape and atomicity: loan rows must be excluded from purchase item/tender/change flows, and the wallet balance replacement must retain its tender/change branches. Item 5 owns salary-cycle installments: share UI only, no inherited reset or expense semantics. Item 6 lands its currency registry/precision/zero accumulators first; no USD/LBP-only literal union, array or “other currency” assumption in new code. Item 8 owns numeric inputs: consume its resolved input behavior, do not patch caret behavior independently. Orchestrator owns migration ordering and the round-3 index.

## Review focus

1. Two tabs or a retried response post the final payment: at most one distinct payment fits; a replay returns its existing event (Tasks 1–3).
2. The principal/rate product exceeds integer precision even when inputs are safe: exact fee/total, half-up ties and cap rejection agree in JS/SQL (Tasks 1–2).
3. Existing cash was already counted, or a category report includes a principal movement: no duplicate wallet funds, fee expense/income counted exactly once (Tasks 2–4).
4. A saved payment is voided/restored after later events, or a generic/direct API modifies it: allocations remain valid, history remains linked and forbidden changes fail (Tasks 2–4).
5. Archived or foreign wallet/category IDs, mixed currencies, SYP, and long Arabic input: isolate tenants, reject wrong currencies, preserve exact balances and usable mobile layout (Tasks 2–5).

## Implementation tasks — future, unchecked

### Task 1: Exact terms, percentage and repayment rules

**Files:** new `src/features/loans/schema.ts`, `calculations.ts`, `schema.test.ts`, `calculations.test.ts`; modify `src/lib/money.ts`, `src/lib/money.test.ts`. Interfaces are the types/helpers above; consume item 6's `Currency` and precision metadata.

- [ ] Write failing unit cases: `7.25`/`٧٫٢٥` → 725 bps, 0 and 100 accepted, `7.251`, `1,5`, negative, exponent and NaN rejected; principal 100000/bps 725 → fee 7250/total 107250; principal 5/bps 1000 → fee 1/total 6; a tiny valid fee can round to 0; MAX_MINOR with 0 bps accepted, MAX_MINOR with 1 bps rejected. Cross-check principal 499999999999999/bps 1 → fee 50000000000/total 500049999999999 (unsafe intermediate multiplication).
- [ ] Write failing schema/calculation cases for calendar invalidity, new-mode opening paid != 0, existing opening principal/fee caps, partial split `(65000,60000,7250) → (60000,5000)`, full settlement, zero and one-minor overpay rejection, opening-paid component subtraction, currency-separated loan summaries and unsupported aggregate magnitude returning null.
- [ ] Run `pnpm exec vitest run src/lib/money.test.ts src/features/loans/schema.test.ts src/features/loans/calculations.test.ts`; confirm new assertions fail for the intended missing behavior.
- [ ] Implement the exact public helpers and zod schemas; action-side date bound additionally consumes authoritative profile timezone. Do not use `parseFloat`, binary percentage multiplication or conversion hints for loan accounting.
- [ ] Repeat the targeted command; expect all passing. No commit step.

### Task 2: Atomic loan ledger and RLS

**Files:** two assigned migrations; new `supabase/tests/loans.test.sql`, `supabase/tests/loans-concurrency.test.mjs`; modify `supabase/tests/isolation.test.sql`. Produces loans/events/progress and the seven RPCs defined above; consumes item 1/4/6 schema changes in their final form.

- [ ] Reserve two exact migration IDs with orchestrator. Write rollback-contained pgTAP tests using synthetic accounts A/B and independent USD/other accepted currency wallets/categories. Assert fee examples from Task 1 in SQL, both directions' wallet deltas, existing mode no movement/no opening reporting, every remaining component, zero-fee and completed loans.
- [ ] Add DB failure assertions for foreign loan/wallet/category (select/insert/update/RPC), kind-mismatched fee category, archived destination, mixed-currency payment, invalid date, forged owner/currency/split/flow, missing new-loan disbursement, extra existing-loan disbursement, detached association, ordinary↔loan kind changes, changing immutable terms, overpayment, generic direct mutations and absent auth. Exercise deferred invariants with `SET CONSTRAINTS ALL IMMEDIATE` inside caught test subtransactions; a rollback-only test that never flushes deferred checks is insufficient. Assert payment reference/currency locks prevent wallet/category deletion or mutation. Include account cleanup cascade and grants checks.
- [ ] Add lifecycle tests: second repayment before latest date rejected; latest void restores balances and fee report; old void fails with later live payment; valid restore reapplies original components; restore after new allocation conflict fails; canceled loan cannot revive event; cancel reverses disbursement only with no live payment; settling archive/void reopens correctly. Verify soft-deleted history remains linked and reads isolate B in all views.
- [ ] Run `pnpm db:test` against an already authorized disposable local test stack; expect the added tests to fail before migration implementation. During this planning session no stack or test is started.
- [ ] Implement SQL invariants/RPCs and rebuild the wallet balance view explicitly for loan in/out flow, retaining transfers/exchanges and all intervening migrations. Deferred checks must validate final aggregate state at commit, including direct client DML. Create/payment request replay compares canonical fields and cannot reinterpret different payloads.
- [ ] Implement a two-connection Node test using Node's built-in test runner and existing Supabase client. It uses **only explicitly provided local synthetic test-user sessions**, never discovers credentials from `.env.local`, never uses production URLs/real accounts, and refuses non-loopback targets. Race final payments, identical retries, payment vs cancel, payment vs void, and currency/archive vs payment; assert one consistent final ledger, no overshoot, duplicates or deadlocks. Missing test credentials means explicitly unverified, never a false pass.
- [ ] Run `pnpm db:test` and `node --test supabase/tests/loans-concurrency.test.mjs` on the authorized local stack, with supplied test sessions. Expect all assertions pass. Generate/merge DB types once with the orchestrator after its migration batch, using `pnpm db:types`; do not clobber another session's generated file. No reset of an existing personal database, migration deployment or commit is included.

### Task 3: Authenticated application boundary and synthetic queries

**Files:** new `src/features/loans/{actions,queries}.ts`, `actions.test.ts`; modify `src/lib/supabase/action.ts`, `src/lib/demo-data.ts`, `src/features/wallets/actions.ts`. Produces the actions/query interfaces above; consumes Task 2 RPCs.

- [ ] Write action tests with mocked auth/RPC: invalid values rejected before RPC, demo yields `notConfigured`, missing user fails, each operation uses exactly its intended single RPC, mapped DB errors are useful, successful writes invalidate layout, failures do not claim success, duplicate request keeps its ID. A 0-row/nonexistent loan edit must not return success; the RPC must distinguish it.
- [ ] Implement all seven server actions with input validation, authenticated `actionClient`, authoritative timezone validation and safe errors. Extend shared `ActionError` without removing existing codes. Do not perform multi-step insert/compensating rollback in JavaScript.
- [ ] Implement server-only `getLoans`, batched history and checked SQL numeric decoding. Create synthetic borrowed/lent/settled/existing/voided examples; ensure synthetic Activity, Loan detail, wallet balance and fee-report fixtures agree. Errors render differently from empty results. Do not load every loan into app layout/Home.
- [ ] Extend wallet reference guards and coordinate fee-category in-use/archive behavior with item 1. Historical reversal can use an archived original wallet; new payments cannot. Default-wallet edits never change earlier events.
- [ ] Run `pnpm exec vitest run src/features/loans/actions.test.ts src/features/loans/schema.test.ts src/features/loans/calculations.test.ts`; expect passing. No commit step.

### Task 4: Reporting and Activity integration

**Files:** same assigned loans migration for `reporting_entries`/RPC/view changes before it ships; modify `src/features/transactions/{schema,queries,actions,group}.ts`, `group.test.ts`, `src/components/transactions/{transaction-row,detail-sheet,activity-view}.tsx`, `src/components/add/transaction-sheet.tsx`, demo fixtures, `supabase/tests/budgets.test.sql`; add targeted transaction tests as needed. Preserve item 2's parent-only cost contract; establish one reporting projection rather than per-reader loan exceptions.

- [ ] Write failing reporting SQL tests: borrowed example contributes 0, 5000, 2250 cents in respective payment months; lent contributes corresponding income only; opening balances, principal, transfers and deleted rows contribute nothing. Fee category parent rollup works. An ordinary expense with breakdown/cashier settlement from items 2/4 still counts once. Guard both exclusive month bounds and mixed currencies.
- [ ] Write failing `group.test.ts` cases for gross loan wallet sign versus signed fee-only day total, borrowed/lent zero-fee events, settlement and accepted SYP values through the currency registry. Add query/action tests proving loan filter and fee-bearing expense/income predicates paginate one event each, legacy transaction mapping sets `loan:null`, and generic edit/delete/restore reject loan IDs with `managedTransaction`.
- [ ] Implement the shared fee reporting projection and wire `month_category_spend` and fee-aware Activity predicates to it; document that any subsequently built monthly summary/Reports/drilldown consumes this same contract. Ordinary itemized expenses still contribute only their parent's cost. Keep gross wallet movement out of reporting aggregates. Reconcile labels/links so a fee category detail finds the same loan events its amount describes.
- [ ] Extend query mapping, `signedMinor`, `reportingMinor`, day totals, row/detail labels and filters. Disable generic edit/duplicate/delete for loan events and provide “Open loan”; enforce the generic-action guard too. Keep keyset ordering stable; fix `initial.kind !== 'transfer'` assumptions in generic Add/edit code now that another kind exists.
- [ ] Run `pnpm exec vitest run src/features/transactions src/features/loans src/lib/money.test.ts src/features/fixed/summary.test.ts src/features/budgets/rows.test.ts` and `pnpm db:test`; expect all passing, including unchanged installment purchase semantics. No commit step.

### Task 5: Bilingual Loans surface and end-to-end acceptance

**Files:** new loan route/loading and four components from the file map, new `e2e/loans.spec.ts`; modify `src/components/shell/composer.tsx`, `src/components/wallets/wallets-view.tsx`, both message files and relevant product/architecture/mobile/plan docs. Interfaces: `LoansView({loans}: {loans: Loan[]})`; composer `openLoanCreate(): void`, `openLoanDetail(id: string): void`, `openLoanPayment(loan: Loan): void`. Detail lookup must work for Activity events linking a loan not already on the current route; resolve data server-side through the Loans destination/query parameter rather than a client Supabase read.

- [ ] Read `impeccable`, prepare the reviewable EN/AR 390px layout against the existing direction contract, then implement within separately authorized execution scope. No redesign/new palette/dependency is part of this item.
- [ ] Write demo e2e assertions for Wallets→Loans, separate direction/currency totals, visible fee/total rounding, explicitly chosen movement mode, existing-loan paid-before fields, missing wallet/category state, same-currency payment selection, overpayment disabling, principal/fee preview, history, cancellation explanation, latest-only void explanation and preview-only submission error. Confirm generic loan Activity detail cannot duplicate/edit/delete through ordinary flows.
- [ ] Build route/server reads and stable skeleton/error/empty states; compose sheets through existing provider. Deep-link `/<locale>/loans?loanId=<uuid>` from Activity/Home without requiring global loan state; validate query and scope lookup to auth user. Await typed route `params`/`searchParams` consistent with installed Next docs and current routes.
- [ ] Complete both translations, Arabic input/digits and mixed-name isolation; use `Amount` for money and localize percentages from integer bps. Show safe in-form errors, pinned actions and actionable restore failures. Refresh authoritative balances/history after writes and roll back optimistic state on failure.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm exec vitest run src/features/loans src/features/transactions src/lib/money.test.ts src/features/fixed/summary.test.ts src/features/budgets/rows.test.ts src/messages/messages.test.ts`, `pnpm db:test`, and the local concurrency command. Expect exit 0; record skipped environment-dependent checks explicitly.
- [ ] In the separately authorized build session run `pnpm exec playwright test e2e/loans.spec.ts e2e/installments.spec.ts e2e/move.spec.ts e2e/budgets.spec.ts --project=mobile-small --project=iphone --project=android --project=desktop`. Existing config starts a demo server; **do not run this during planning**. Tests explicitly cover EN/AR. Then run a synthetic authenticated local scenario creating both directions, partial/final repayment, failed overpay and void/restore; demo previews alone do not establish write correctness.
- [ ] Review screenshots at 320/390/430/768/1280px in both locales/themes, long Arabic names, large local-currency amounts, 200% text, reduced motion and keyboard-open real iOS/Android. Check ≥44px targets, no horizontal overflow, focus trap/return and reachable Save. Run the project's available accessibility checks; if axe tooling is absent, record that limitation and perform a documented keyboard/screen-reader pass without quietly adding dependencies. Run `pnpm build` if the shared migration/type/route batch requires a production integration check. Update docs to explain one-time fee/cash-basis reporting, correction limits and exclusions. No staging, commit or push.

## Material questions for the orchestrator

These questions do not block this planning deliverable. They should be consolidated with the owner **before eventual financial behavior is built**; all tasks above assume the proposed defaults until then.

1. Is the confirmed one-time percentage fee **added to the amount repaid**, or **withheld upfront**? Recommendation: additive fee, two decimal percentage places, half-up rounding and principal-first repayment as specified above. Withholding would require different opening cash and fee recognition. Do not ask again about loan directions or recurring versus one-time: both directions and one-time charging are already confirmed.
2. Are existing loans needed at launch as well as new cash disbursements? Recommendation: include the explicit existing/no-movement path above, with separate principal/fee paid-before inputs. Never automatically credit/debit cash just because a record is created.

## Original planning verification and handoff

Actually done: read repository/project/product/mobile/design guidance, installed Next.js guides, current loan-adjacent implementation, migration chain, SQL/unit/e2e examples, package scripts and round-3 coordination index; self-reviewed this plan for direction, percentage precision, cash disbursement, remaining balances, correction policies, reporting, currency compatibility, RLS and atomicity coverage.

Not run: typecheck, lint, unit/SQL/e2e tests, concurrency checks, servers, migrations or builds. No product code, dependencies, configuration or other documents were changed by this planning session. All checkboxes are future implementation/acceptance work; no test-pass claim is made.

## Phase A execution ledger — 2026-11-04

The owner subsequently confirmed **both borrowed/lent**, **additive one-time fee**, **principal-first payments**, and **explicit existing-loan/no-cash creation**. The material questions above are resolved by that implementation authorization; do not ask them again.

**Rulings and interface changes:**

- Exact fee/percentage helpers remain in `src/features/loans/calculations.ts` under the bounded lease, using the shared string-only `normalizeNumericDigits` and money precision metadata. No shared money file was changed here.
- New UI uses the `Loans` namespace. Its complete EN/AR catalog is provided in `src/features/loans/messages.ts` as `loanMessages` for the parent to merge into both shared catalogs during integration. `loanErrorKey` maps safe local errors. Shared catalog edits are deliberately not performed in Phase A.
- `LoanActionResult` has the existing discriminated `ActionResult` shape, with local loan error additions pending shared-union integration. `getLoans` owns a local synthetic `demoLoans()` factory; the examples are existing/no-cash loans, so they do not invent disbursements in shared demo wallets/Activity.
- Reserved migrations are **20261111000600_loan_kind.sql** and **20261111000700_loans.sql**. The latter extends the actual preceding shape/source predicates, excludes loan rows from the common transaction integrity trigger while retaining that trigger for all other kinds, and validates loans with their own guard. Its balance projection retains cashier tender debits/change credits and transfer credits. Loans own `reporting_entries`.
- Parent integration review required category-reference/lifecycle extensions in the loan migration: direction-aware fee category validation (including zero-fee payments), live loan references blocking archive/remove, all loan references protecting hard deletion, and unchanged historical archived categories allowed for reversal. Auth-user cleanup exemption is preserved. SQL regressions cover reassignment and these guards.
- Parent integration review required **exact captured transaction revisions**. `record_loan_payment` now returns `{id,revision}`; `void_loan_payment(p_transaction_id,p_expected_revision)` and `restore_loan_payment(p_transaction_id,p_expected_revision)` return the resulting `{id,revision}` and reject stale generations with `loan.conflict`. Actions take `(id, expectedRevision)`. `LoanEvent` includes `revision`; confirmation freezes event ID/revision, and Undo captures the creator result. `createLoan` returns the loan aggregate ID (existing-mode creation has no transaction to revision). Generic `set_transaction_deleted` explicitly rejects managed loan events while preserving the canonical ordinary lifecycle.
- SQL RPC input shapes/types are validated independently of zod. Wide numeric fee math, immutable terms, per-loan row locks, idempotent request payloads and deferred aggregate checks remain authoritative. No privileged application client, secret access, hosted setting/migration change, dependency change or global test run was used in this lease.

**Delivered in Phase A:**

- [x] Exact percentage/fee/allocation/summary helpers and strict date/create/edit/payment schemas.
- [x] Authenticated actions for all loan operations, strict safe error mapping and single-RPC writes.
- [x] Batched progress/history query with numeric range checks, synthetic demo data and visible failure state.
- [x] Loans page/loading/error and list, create/edit, details/history, repayment, confirmation and restore UI modules using the established design, active category selector, same-currency wallets, isolated amounts and pinned sheet actions.
- [x] Both reserved migration files; fee-only reporting, wallet projection, category protections, source/lifecycle guards and revision-safe loan events.
- [x] Rollback SQL regression suite and six local-only concurrency scenarios (execution status below).

**Checks actually run in this session:**

- `pnpm exec vitest run src/features/loans src/components/loans` — **20 tests passed in 6 files**, including Arabic input retention, overpayment prevention, query bounds/errors, fee math, schema and action contracts. Initial domain/action imports failed before their implementation; subsequent runs passed.
- `pnpm exec eslint src/features/loans src/components/loans 'src/app/[locale]/(app)/loans'` — exit 0.
- A TypeScript compiler API check rooted only in the **19 loan-owned TS/TSX files**, no emitted files and filtered to owned diagnostics — **0 owned diagnostics**. This is not a global typecheck/build claim.
- `node --test supabase/tests/loans-concurrency.test.mjs` — **six explicitly skipped** because local synthetic-user test sessions were not supplied. This is not evidence that concurrency passed.
- Parent-coordinated sanitized PG18 probe log `probe2-loans.test.sql.log` was inspected: **58 assertions passed** at that checkpoint, including category guards and stale-generation Undo. Additional RPC-shape, generic managed-lifecycle, SYP and auth-cleanup assertions were added after that checkpoint and still require the parent's fresh migration/test pass. This session did not start, reset or mutate that probe stack.

**Phase A handoff limitations (superseded by the integration ledger below):** shared translations/navigation/Activity queries and signs/fee-aware filtering, generic transaction action guards, shared demo/ActionError/currency final merge, wallet action preflight messages, route screenshots/E2E/accessibility/real-phone keyboard checks, complete hosted/local-Supabase behavior, SQL concurrency and final combined typecheck/lint/build were pending at the Phase A checkpoint.

## Final shared integration ledger — 2026-11-04

Shared source lease is **closed and frozen**. Only this plan's handoff notes were updated after freeze; parent owns final global typecheck, production build, root documentation and combined commit/push.

- [x] Merged the `Loans` namespace into both global catalogs and removed the duplicate private catalog. Loan errors now use `errors.ts` and shared `ActionResult`/`ActionError`.
- [x] Added Wallets navigation to Loans, including the no-active-wallet state. Loan forms select active root fee categories and currency-compatible wallets.
- [x] Added canonical transaction loan event/component metadata, query mapping, fee-aware expense/income/Loans filters and fee-only day reporting. Wallet/cashier destination matching, parent-only item cost, source metadata, exact revisions and keyset clauses are preserved. Category filters exclude zero-fee principal events.
- [x] Added managed Activity detail labels, the principal/fee explanation and actual Open loan deep links. Generic financial edits/deletes remain unavailable for loan rows.
- [x] Centralized synthetic loan/history/Activity fixtures in `src/lib/demo-data.ts`; retained existing fixtures and added a dedicated loan wallet whose balance reconciles to its live synthetic events. Seeded borrowed/lent, principal-only, voided, settled and SYP examples; fee-only demo spending uses a distinct fee category.
- [x] Wired `deleteWallet` to atomic `delete_wallet`, with safe invalid/history/in-use error mappings and transport failure handling. Wallet/category in-use copy includes installment and loan references.
- [x] Preserved cycle lock order in migration 007's generic managed-row guard by acquiring `cycle_private.lock_transaction_scope` before delegating to the retained exact-revision lifecycle. The migration does not replace migration 005's correctly ordered save wrapper.
- [x] Payment creation replay accepts only the original live revision-1 event; old create retries after void or void/restore return conflict instead of acquiring a newer Undo generation. SQL regressions cover both cases.
- [x] Added retained loan creation/payment submissions: exact payload/UUID, immediate in-flight guard, frozen configuration, blocked pending/uncertain sheet dismissal, native unload warning and Retry independent of refreshed balance/catalog eligibility. Unknown action transport failures remain safe failed results; definite lifecycle conflicts offer review of the latest loan. Component regressions cover failed and thrown outcomes, pending duplicate clicks, dismissal, and refreshed empty catalogs/settled balances.
- [x] Paginated all loan/progress and event reads below the default PostgREST row cap, with deterministic unique ordering, duplicate/error rejection and linear history grouping. Boundary regression retrieves 1,001 loans and 1,101 events without truncation.
- [x] Extended the installment cycle payment decoder with explicitly null-safe loan event/component fields and legacy-fixture null defaults, preserving the full canonical transaction DTO.
- [x] Added EN/AR mobile loan E2E coverage for directions, one-time calculations, explicit movement/existing mode, historical component caps, partial repayment/overpayment, separate currencies, gross Activity versus fee-only totals, managed links and preview void/restore errors. Width/theme tests include 390px captures. Tests never pretend preview writes persisted.

**Final evidence from this loan session:** 66 targeted tests passed in 13 files; targeted lint exited 0; compiler checks rooted in the loan-owned/integration files reported zero diagnostics. The focused mobile Activity → Open loan case passed using a real click. Explicit sheet title/description associations preserve accessible names; test-only CSS prevents the Next.js development portal from intercepting footer taps, without forcing clicks through product UI. No development server or hosted environment was started or changed by this session.

**Parent-reported combined validation:** all 36 previously failed browser cases passed on recheck, including the three loan event cases across all four browser projects. Combined result: **700 demo browser cases passed**, with **8 auth skips covered separately by 4 passing dedicated auth checks**; **475 global unit tests and global lint passed**. Parent also reported successful local Supabase loan writes/reloads in both directions, fee-only expense/income Activity behavior, 476 SQL assertions and six loan HTTP concurrency scenarios. These are parent-coordinated results, not commands rerun by this loan session.

**Remaining verification boundaries:** parent final global typecheck/production build were still running at handoff. Browser emulation does not establish physical iPhone/Android keyboard or screen-reader behavior. No hosted migration/configuration/billing changes, staging, commits or pushes were performed here. No remaining source review blocker was reported by the parent; do not resume source edits unless a real new failure releases a focused lease.
