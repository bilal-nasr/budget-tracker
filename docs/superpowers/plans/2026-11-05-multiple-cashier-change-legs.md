# Multiple Cashier Change Legs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one expense record a separately entered purchase cost, one tender amount, and multiple actual returned-change amounts such as USD 5 plus an LBP remainder, without calculating an exchange rate.

**Architecture:** Replace the single settlement change with an ordered `changes` collection. Store the collection in an owner-scoped child table, keep `transactions.tender_minor`, and use a derived wallet-ID array only for indexed Activity filtering; the child rows remain canonical for amounts, currencies, history, and balances. Preserve legacy rate metadata during migration/read/edit, but new drafts record actual cash only.

**Tech Stack:** Next.js 16.4.5 App Router, React 19 client components, TypeScript, Zod, next-intl, Supabase/PostgreSQL 17, Vitest/Testing Library, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-multiple-cashier-change-legs-design.md`

## Global Constraints

- Purchase cost remains the expense amount used by spending and budget reports.
- Debit the paying wallet by tender once and credit every returned amount once, atomically.
- New multi-currency change uses actual amounts only; never infer, request, or update a rate.
- Preserve existing single-change expenses and their historical rate metadata.
- New or financially changed settlements require active owner-matching wallets; unchanged metadata edits may retain archived receivers.
- Save, edit, duplicate, replay, delete, restore, filtering, and English/Arabic display must cover every leg.
- Follow `node_modules/next/dist/docs/01-app/01-getting-started/{05-server-and-client-components,07-mutating-data}.md` and the installed Vitest/Playwright guides.

## Review Focus

- Mixed USD change cannot reduce the net USD tender below the entered cost even when an LBP leg exists; Task 1 pins this boundary.
- Summing many valid minor amounts must not overflow JavaScript safe integers or PostgreSQL `bigint`; Tasks 1 and 2 use exact aggregate checks.
- A metadata-only edit with an archived receiver succeeds only when payer, cost, tender, ordered legs, amounts, wallets, and retained rate metadata are unchanged; Tasks 2 and 4 cover both branches.
- A wallet filter must match a purchase when the wallet appears only in the second change leg, without duplicating the parent or breaking keyset pagination; Tasks 2 and 3 cover this.
- Repeated receiving-wallet rows and same-wallet tender/change must credit every leg exactly once and remain reversible; Task 2 proves save/delete/restore balance effects.

---

### Task 1: Settlement collection domain contract

**Files:**
- Modify: `src/features/transactions/settlement.ts`
- Modify: `src/features/transactions/settlement.test.ts`
- Modify: `src/features/transactions/settlement-serialization.ts`
- Modify: `src/features/transactions/settlement-serialization.test.ts`

**Interfaces:**
- Produces: `CashSettlementInput = { tenderMinor: number; changes: CashChangeInput[] }` and `SettlementSnapshot = { tenderMinor: number; changes: SettlementChangeSnapshot[] }`.
- Produces: `validateSettlement({ costMinor, payCurrency, changeCurrencies, settlement })` where `changeCurrencies` aligns by index with `settlement.changes`.
- Preserves: optional `SettlementRate` only on migrated historical snapshots.

- [ ] **Step 1: Write failing domain tests** for USD 20 tender, USD 5 plus positive LBP change; same-currency totals; no-change exact tender; mixed settlements whose same-currency return makes net tender equal to or below cost; malformed/zero legs; and a many-leg total beyond `MAX_MINOR`.
- [ ] **Step 2: Run** `pnpm exec vitest run src/features/transactions/settlement.test.ts` and confirm failures reference the missing `changes` contract.
- [ ] **Step 3: Implement** the strict `changes` schema and exact validation. Use `BigInt` for aggregate same-currency comparisons; same-currency-only change must reconcile exactly, while mixed currency requires `tender - sameCurrencyReturned > cost`.
- [ ] **Step 4: Run the domain test** and confirm it passes.
- [ ] **Step 5: Write failing serialization tests** proving ordered two-leg rows decode to two snapshots, historical rate fields survive, missing/partial embedded rows reject, and serialize uses `{ tenderMinor, changes }` with preserve/clear semantics unchanged.
- [ ] **Step 6: Run** `pnpm exec vitest run src/features/transactions/settlement-serialization.test.ts` and confirm the old single-column boundary fails.
- [ ] **Step 7: Implement** a row boundary using `tender_minor` plus embedded `cashier_changes` ordered by `position`; validate all integers/currencies before returning a snapshot.
- [ ] **Step 8: Run** `pnpm exec vitest run src/features/transactions/settlement.test.ts src/features/transactions/settlement-serialization.test.ts` and confirm both pass.
- [ ] **Step 9: Commit** with `git commit -am "refactor: model cashier change as a collection"`.

### Task 2: Normalize cashier change persistence and accounting

**Files:**
- Create: `supabase/migrations/20261119000000_multiple_cashier_changes.sql`
- Create: `supabase/tests/multiple_cashier_changes.test.sql`
- Create: `supabase/tests/multiple-cashier-changes-concurrency.mjs`

**Interfaces:**
- Consumes: the `{ tenderMinor, changes: [{ walletId, amountMinor, rate? }] }` JSON contract from Task 1.
- Produces: `public.cashier_changes(transaction_id, user_id, wallet_id, amount_minor, currency, position, legacy rate columns)` and `transactions.change_wallet_ids uuid[]` as a derived filter index.
- Preserves: public `save_transaction(uuid, integer, jsonb, jsonb, jsonb)` and lifecycle RPC signatures.

- [ ] **Step 1: Write failing pgTAP coverage** for migration of a legacy single change, the exact USD 20 / USD 5 / LBP example, repeated receiver rows, same-wallet netting, report cost, RLS isolation, replay mismatch, edits, explicit clear, archived receiver rules, wallet currency/delete protection, and delete/restore reversal.
- [ ] **Step 2: Run** `pnpm db:test` against the disposable local stack and confirm the new test fails because the table/array contract is absent.
- [ ] **Step 3: Add the child table and migration** with owner-scoped FK/RLS select access, deterministic positions, exact minor checks, optional legacy-rate columns, indexes, legacy row backfill, and canonical nulling of old single-change columns.
- [ ] **Step 4: Replace settlement database behavior**: update the cashier validator/trigger, snapshot and aggregate-save implementation, `wallet_balances`, wallet currency/delete guards, and the GIN-backed `change_wallet_ids` projection. Parse and lock every old/new wallet in deterministic order; replace all child rows in the same transaction and seal replay receipts only after final constraints pass.
- [ ] **Step 5: Run** `pnpm db:test` and confirm the full SQL suite passes.
- [ ] **Step 6: Write the two-session concurrency regression** proving an overlapping settlement edit or wallet currency change cannot interleave with multi-leg replacement and leave stale legs, mixed currencies, or double credits.
- [ ] **Step 7: Run the concurrency script** only against the designated disposable PG17 target and confirm its barrier-based assertions pass.
- [ ] **Step 8: Commit** with `git add supabase && git commit -m "feat: persist multiple cashier change legs"`.

### Task 3: Connect mutations, reads, demo data, and wallet filtering

**Files:**
- Modify: `src/features/transactions/mutation-input.ts`
- Modify: `src/features/transactions/mutations-core.test.ts`
- Modify: `src/features/transactions/queries.ts`
- Modify: `src/features/transactions/queries.test.ts`
- Modify: `src/features/transactions/activity-filter.ts`
- Modify: `src/features/transactions/loan-activity.test.ts`
- Modify: `src/lib/demo-data.ts`

**Interfaces:**
- Consumes: Task 1 settlement types and Task 2 `cashier_changes` relation plus `change_wallet_ids` filter column.
- Produces: `Transaction.settlement` with ordered `changes`; aggregate RPC payloads forward the collection unchanged.

- [ ] **Step 1: Update failing mutation tests** to assert one RPC receives the exact two-leg settlement and rejects forged fields/invalid legs before database access.
- [ ] **Step 2: Update failing query/filter tests** so an embedded two-leg relation maps to one ordered parent and `activityOrClause` uses `change_wallet_ids.cs.{walletId}` inside the existing ANDed cursor expression.
- [ ] **Step 3: Run** `pnpm exec vitest run src/features/transactions/mutations-core.test.ts src/features/transactions/queries.test.ts src/features/transactions/loan-activity.test.ts` and confirm the old payload/projection/filter assertions fail.
- [ ] **Step 4: Implement** the mutation, nested select/mapping, array filter expression, and demo settlement changes without introducing a second query or multiplying parents.
- [ ] **Step 5: Run the targeted tests** and confirm they pass.
- [ ] **Step 6: Commit** with `git commit -am "feat: read and filter multiple cashier changes"`.

### Task 4: Build the repeatable cashier form

**Files:**
- Modify: `src/components/add/cash-settlement-fields.tsx`
- Modify: `src/components/add/cash-settlement-fields.test.tsx`
- Modify: `src/components/add/cash-settlement-labels.ts`
- Modify: `src/components/add/transaction-sheet.tsx`
- Modify: `src/components/add/transaction-breakdown.test.tsx`
- Modify: `src/messages/en.json`
- Modify: `src/messages/ar.json`
- Modify: `src/messages/messages.test.ts`

**Interfaces:**
- Produces: `CashSettlementDraft = { enabled: boolean; tenderText: string; changes: CashChangeDraft[] }` with stable row keys.
- Produces: add/remove-row callbacks inside `CashSettlementFields`; `parseSettlementDraft` returns the Task 1 collection.

- [ ] **Step 1: Write failing component tests** that add a second row, select LBP, enter USD 20 / USD 5 / LBP change, remove either row, reset only the edited row on currency change, use LTR numeric fields in Arabic, and block incomplete/invalid rows.
- [ ] **Step 2: Add failing edit/duplicate tests** proving all rows hydrate; unchanged archived rows survive metadata edits; any financial change requires every receiver active; duplication keeps amounts/wallets but drops legacy rates and uses a fresh draft ID.
- [ ] **Step 3: Run** `pnpm exec vitest run src/components/add/cash-settlement-fields.test.tsx src/components/add/transaction-breakdown.test.tsx` and confirm failures are caused by the single-row draft.
- [ ] **Step 4: Implement** the controlled repeatable rows, localized Add/Remove labels, per-row currency/wallet choices, shared parser, and transaction-sheet state integration. Keep this interactive module inside the existing client boundary and continue calling the authenticated Server Action from `startTransition`.
- [ ] **Step 5: Run** `pnpm exec vitest run src/components/add/cash-settlement-fields.test.tsx src/components/add/transaction-breakdown.test.tsx src/messages/messages.test.ts` and confirm the component and message-catalog tests pass in English and Arabic cases.
- [ ] **Step 6: Commit** with `git commit -am "feat: add repeatable cashier change fields"`.

### Task 5: Show every returned amount in Activity

**Files:**
- Modify: `src/components/transactions/cash-settlement-summary.tsx`
- Create: `src/components/transactions/cash-settlement-summary.test.tsx`
- Modify: `src/components/transactions/detail-sheet.tsx`
- Modify: `src/components/transactions/transaction-row.tsx`
- Modify: `e2e/cashier.spec.ts`

**Interfaces:**
- Consumes: ordered `SettlementSnapshot.changes` and `walletById`.
- Produces: an accessible summary row for every amount and receiving wallet, plus a compact Activity-row destination line.

- [ ] **Step 1: Write a failing summary test** asserting cost `$12.50`, tender `$20.00`, USD `$5.00` to the USD wallet, and the LBP amount to the LBP wallet all render once; no-change renders the localized fallback.
- [ ] **Step 2: Run** `pnpm exec vitest run src/components/transactions/cash-settlement-summary.test.tsx` and confirm the single-change props fail.
- [ ] **Step 3: Implement** collection rendering in the summary/detail/row components, retaining historical rate text only beside the leg that owns it.
- [ ] **Step 4: Extend the bilingual Playwright flow** to add the second row, verify Save validity and no rate controls, inspect the saved/demo multi-leg detail, duplicate it, exercise a second-leg wallet filter, and check horizontal overflow.
- [ ] **Step 5: Run** `pnpm exec vitest run src/components/transactions/cash-settlement-summary.test.tsx` and `pnpm exec playwright test e2e/cashier.spec.ts`; confirm both pass.
- [ ] **Step 6: Commit** with `git add src/components/transactions e2e/cashier.spec.ts && git commit -m "feat: show all cashier change legs"`.

### Task 6: Documentation and whole-project verification

**Files:**
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: the completed implementation.
- Produces: durable product and architecture documentation matching the shipped behavior.

- [ ] **Step 1: Update documentation** from singular returned change to ordered actual change amounts, child-row atomicity, and separate cost/tender accounting.
- [ ] **Step 2: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm db:test`, and `pnpm exec playwright test`; record every failure by command and test name.
- [ ] **Step 3: Run** `git diff --check` and inspect `git status --short` so generated or unrelated files are not included.
- [ ] **Step 4: Commit** with `git commit -am "docs: describe multi-leg cashier settlements"`.
