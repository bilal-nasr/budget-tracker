# Cross-Currency Purchase Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record one expense whose purchase cost, cashier tender, and returned change may use different currencies, preserving LBP 340,000 cost, USD 5 tender, and LBP 110,000 change without conversion.

**Architecture:** Add an optional storage-only `transactions.cost_currency` while retaining `transactions.currency` as the payer-wallet currency. Expose the effective cost currency (`cost_currency ?? currency`) as `Transaction.currency` to reporting/UI code, and expose the storage currency as `SettlementSnapshot.tenderCurrency` for wallet-ledger and cashier display. Extend the existing atomic cashier aggregate and exact-replay path rather than creating linked transactions.

**Tech Stack:** Next.js 16.4.5 App Router, React 19, TypeScript, Zod, next-intl, Supabase/PostgreSQL 17, Vitest/Testing Library, pgTAP, Playwright, ExcelJS.

**Spec:** `docs/superpowers/specs/2026-11-05-cross-currency-purchase-cost-design.md`

## Global Constraints

- Store and display the exact observed amounts: LBP 340,000 cost, USD 5 tender, LBP 110,000 change.
- Never derive, request, save, round, or infer an exchange rate or hidden combined exchange amount.
- Cost reporting uses `coalesce(cost_currency, currency)`; physical wallet movements use payer/change wallet currencies.
- A differing cost currency is valid only for an ordinary expense with a cashier settlement.
- Preserve same-currency reconciliation, legacy rates, source-managed transaction rules, RLS, deterministic wallet locking, revisions, exact replay, delete/restore, and archived-wallet behavior.
- Preserve all historical rows: null `cost_currency` must produce identical balances, reports, and UI.
- Follow `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`, `07-mutating-data.md`, and `node_modules/next/dist/docs/01-app/02-guides/forms.md` before changing framework-facing code.
- Keep English/Arabic parity, RTL safety, whole-pound LBP/SYP units, USD cents, and shared money parsing/formatting.

## Review Focus

- A cross-currency cost with no change is valid and never triggers a numeric tender-versus-cost comparison; Tasks 1 and 2 pin it.
- Clearing settlement while cost currency differs from the payer wallet is rejected without losing the saved entry; Tasks 2, 3, and 4 pin it.
- Changing a payer wallet across currencies preserves cost/change facts, clears the unsubmitted tender text, and never converts; Task 4 pins it.
- An update payload that omits `costCurrency` preserves an existing override, while exact replay with a different explicit cost currency conflicts; Tasks 2 and 3 pin it.
- Export and monthly summaries separate LBP operating expense from USD wallet outflow and still reconcile every wallet to zero difference; Task 5 pins it.

---

### Task 1: Define the independent-currency domain contract

**Files:**
- Modify: `src/features/transactions/settlement.ts`
- Modify: `src/features/transactions/settlement.test.ts`
- Modify: `src/features/transactions/settlement-serialization.ts`
- Modify: `src/features/transactions/settlement-serialization.test.ts`
- Modify: `src/features/transactions/schema.ts`

**Interfaces:**
- Produces: `validateSettlement({ costMinor, costCurrency, payCurrency, changeCurrencies, settlement })`.
- Produces: `SettlementSnapshot = { tenderMinor: number; tenderCurrency: Currency; changes: SettlementChangeSnapshot[] }`.
- Preserves: `CashSettlementInput = { tenderMinor: number; changes: CashChangeInput[] }`; tender currency remains read-only and wallet-derived.

- [ ] **Step 1: Read the installed Next.js guides** listed in Global Constraints and note any changed server/client or mutation constraints before editing.
- [ ] **Step 2: Write failing settlement tests** named for: LBP `340000` cost with USD `500` tender and LBP `110000` change; LBP cost with USD tender and no change; retained same-currency exact reconciliation; retained mixed-change same-currency remainder boundary; malformed currencies and amounts.
- [ ] **Step 3: Run** `pnpm exec vitest run src/features/transactions/settlement.test.ts` and confirm RED because cost and tender currency are not independent.
- [ ] **Step 4: Extend `validateSettlement`** with exact `costCurrency` and `payCurrency` inputs. Use `BigInt` only when currencies match; when they differ, validate each positive amount and currency pair independently without comparing numeric values.
- [ ] **Step 5: Write failing serialization tests** proving a row with effective LBP cost and USD payer hydrates `tenderCurrency: "USD"`, preserves ordered changes/rates, and rejects missing/partial projections.
- [ ] **Step 6: Extend `readSettlementSnapshot`** to accept `{ kind, costCurrency, payCurrency, amountMinor }`, validate with both currencies, and return `tenderCurrency` without adding it to the write payload.
- [ ] **Step 7: Run** `pnpm exec vitest run src/features/transactions/settlement.test.ts src/features/transactions/settlement-serialization.test.ts` and confirm GREEN.
- [ ] **Step 8: Commit** `src/features/transactions/{settlement,settlement.test,settlement-serialization,settlement-serialization.test,schema}.ts` with message `feat: separate cashier cost and tender currencies`.

### Task 2: Persist cost currency and preserve atomic accounting

**Files:**
- Create: `supabase/migrations/20261122000000_cross_currency_purchase_cost.sql`
- Create: `supabase/tests/cross_currency_purchase_cost.test.sql`
- Modify: `supabase/tests/multiple-cashier-changes-concurrency.mjs`
- Modify: `src/lib/supabase/database.types.ts`

**Interfaces:**
- Produces: nullable `public.transactions.cost_currency public.currency`.
- Produces: effective reporting currency `coalesce(cost_currency, currency)` while `transactions.currency` remains payer-wallet currency.
- Preserves: public `save_transaction(uuid, integer, jsonb, jsonb, jsonb)` and lifecycle RPC signatures.
- Consumes: optional `p_input.costCurrency`; create omission defaults to payer currency, update omission preserves the existing effective cost currency.

- [ ] **Step 1: Write failing pgTAP coverage** for the exact motivating purchase, cross-currency no-change, same-currency regression, cross-cost-without-settlement rejection, source-managed rejection, ownership/RLS, itemized expense currency, omission-preserving update, explicit currency edit, replay mismatch, archived-wallet rules, delete/restore, and direct-DML forgery.
- [ ] **Step 2: Add report and balance assertions**: USD payer balance changes by `-500`, LBP receiver by `+110000`, LBP category spend is `340000`, USD category spend is absent, and no extra income/transfer row exists.
- [ ] **Step 3: Run** `pnpm db:test` and confirm the new test is RED because `cost_currency` and its invariants do not exist.
- [ ] **Step 4: Add the append-only column migration** with null legacy semantics and update the private row writer to accept/normalize optional `costCurrency` while retaining its strict JSON allowlist, ownership checks, revision rules, item validation, and public RPC signature.
- [ ] **Step 5: Replace cashier final-state validation and snapshots** so cost currency participates in financial-change/replay equality; same-currency rules stay exact; different currencies are never numerically compared; differing cost currency requires a live ordinary settlement.
- [ ] **Step 6: Update currency guards and projections**: breakdown locking compares effective cost currency, cashier wallet guards retain payer currency, `reporting_entries` emits effective cost currency, `month_category_spend` remains grouped by that projection, and `wallet_balances` continues using tender/change only.
- [ ] **Step 7: Preserve lock ordering and lifecycle** by including cost-currency-only edits in active-wallet checks, forcing deferred constraints inside the RPC, and retaining creation-receipt final revision behavior.
- [ ] **Step 8: Extend the two-session concurrency test** so a cost-currency edit cannot interleave with receiver replacement or wallet currency mutation and leave mismatched snapshots or balances.
- [ ] **Step 9: Regenerate or minimally update `database.types.ts`** to include `transactions.cost_currency` in Row/Insert/Update definitions without unrelated formatting churn.
- [ ] **Step 10: Run** `pnpm db:test` and the designated disposable PG17 concurrency script; confirm all database and concurrency assertions pass.
- [ ] **Step 11: Commit** the migration, database tests, concurrency test, and type update with message `feat: persist cross-currency purchase costs`.

### Task 3: Connect mutation and query boundaries

**Files:**
- Modify: `src/features/transactions/mutation-input.ts`
- Modify: `src/features/transactions/mutations-core.test.ts`
- Modify: `src/features/transactions/queries.ts`
- Modify: `src/features/transactions/queries.test.ts`
- Modify: `src/features/installments/cycle-queries.ts`
- Modify: `src/features/installments/cycle-queries.test.ts`
- Modify: `src/lib/demo-data.ts`

**Interfaces:**
- Produces: optional `TransactionWriteInput.costCurrency?: Currency` and forwards it in `p_input` only when present.
- Produces: `Transaction.currency = row.cost_currency ?? row.currency` and `Transaction.settlement.tenderCurrency = row.currency`.
- Preserves: omitted cost currency on updates and exact settlement preserve/clear semantics.

- [ ] **Step 1: Write failing mutation tests** proving explicit LBP `costCurrency` is forwarded with the exact settlement, invalid cost currencies fail before RPC, and omission does not synthesize a client-side rate or amount.
- [ ] **Step 2: Write failing query tests** for a storage row with `currency: "USD"`, `cost_currency: "LBP"`, `amount_minor: 340000`, `tender_minor: 500`, and LBP change `110000`; assert effective transaction currency LBP and tender currency USD.
- [ ] **Step 3: Add regression fixtures** showing legacy null cost currency and installment/source rows hydrate exactly as before.
- [ ] **Step 4: Run** `pnpm exec vitest run src/features/transactions/mutations-core.test.ts src/features/transactions/queries.test.ts src/features/installments/cycle-queries.test.ts` and confirm RED.
- [ ] **Step 5: Implement the strict Zod/write mapping** for optional `costCurrency`, add `cost_currency` to shared transaction projections/row types, and map cost versus tender currency at the single `toTransaction` boundary.
- [ ] **Step 6: Update shared installment/source query fixtures** for the new nullable projection without allowing source-managed cross-currency costs.
- [ ] **Step 7: Add a separate demo cross-currency grocery fixture** while preserving the existing Coffee multi-change fixture and its IDs.
- [ ] **Step 8: Run the targeted tests** from Step 4 and confirm GREEN.
- [ ] **Step 9: Commit** the mutation/query/demo boundary changes with message `feat: hydrate cross-currency purchase costs`.

### Task 4: Build the exact-entry cashier flow

**Files:**
- Modify: `src/components/add/transaction-sheet.tsx`
- Modify: `src/components/add/transaction-sheet.test.tsx`
- Modify: `src/components/add/cash-settlement-fields.tsx`
- Modify: `src/components/add/cash-settlement-fields.test.tsx`
- Modify: `src/components/add/cash-settlement-labels.ts`
- Modify: `src/components/add/transaction-breakdown.test.tsx`
- Modify: `src/messages/en.json`
- Modify: `src/messages/ar.json`
- Modify: `src/messages/messages.test.ts`

**Interfaces:**
- Produces: independent `purchaseCurrency: Currency` state, defaulting to the effective saved cost currency or selected wallet currency.
- Consumes: `parseSettlementDraft(draft, payCurrency, costCurrency, costMinor, wallets, editContext)`.
- Produces: a save payload containing the exact `amountMinor`, `costCurrency`, wallet, tender, and change legs.

- [ ] **Step 1: Write failing composer tests** that enter purchase LBP `340000`, select a USD wallet, enter tender `5`, enter LBP change `110000`, and assert the exact mutation payload with no rate or derived amount.
- [ ] **Step 2: Add failing interaction tests** for cross-currency no-change; item parsing in purchase currency; blocking settlement removal while currencies differ; changing payer USD→LBP while preserving cost/change and clearing tender; changing purchase currency while breakdown exists; edit/duplicate hydration; Arabic numeric input and RTL layout.
- [ ] **Step 3: Add a failing balance-warning test** proving a USD wallet warning compares its balance with tender `500`, not cost `340000` LBP.
- [ ] **Step 4: Run** `pnpm exec vitest run src/components/add/transaction-sheet.test.tsx src/components/add/cash-settlement-fields.test.tsx src/components/add/transaction-breakdown.test.tsx` and confirm RED.
- [ ] **Step 5: Implement purchase-currency state and controls** only for eligible cashier expenses. Use shared currency metadata/keypad parsing, clear the typed cost on purchase-currency change, and keep the current breakdown currency lock.
- [ ] **Step 6: Decouple payer-wallet changes**: preserve purchase currency/cost and returned-change rows, clear tender when payer currency changes, and never convert any field.
- [ ] **Step 7: Update cashier parsing and save validity** to pass both currencies, block settlement removal while they differ, and compute insufficient-balance warning from parsed tender when settlement is enabled.
- [ ] **Step 8: Add matched English/Arabic labels and guidance** for purchase currency, paid-from wallet, and the blocked removal case; retain accessible labels, LTR money inputs, and 44px controls.
- [ ] **Step 9: Run** the targeted component tests plus `pnpm exec vitest run src/messages/messages.test.ts`; confirm GREEN.
- [ ] **Step 10: Commit** the composer and message changes with message `feat: enter cross-currency cashier purchases`.

### Task 5: Separate cost reporting from physical cash display and export

**Files:**
- Modify: `src/components/transactions/cash-settlement-summary.tsx`
- Modify: `src/components/transactions/cash-settlement-summary.test.tsx`
- Modify: `src/components/transactions/detail-sheet.tsx`
- Modify: `src/components/transactions/transaction-row.tsx`
- Modify: `src/features/export/schedules.ts`
- Modify: `src/features/export/schedules.test.ts`
- Modify: `src/features/export/workbook.ts`
- Modify: `src/features/export/workbook.test.ts`

**Interfaces:**
- Consumes: effective `Transaction.currency` for cost/reporting and `SettlementSnapshot.tenderCurrency` for physical payer outflow.
- Produces: primary LBP cost display plus compact USD tender/LBP change summary.
- Produces: export monthly operating expense in LBP and wallet-ledger legs in each wallet's currency.

- [ ] **Step 1: Write a failing summary test** asserting cost `LBP 340,000`, tender `$5.00`, and change `LBP 110,000` render once with the receiving wallet; retain the localized no-change case.
- [ ] **Step 2: Write failing export schedule tests** asserting LBP `340000` operating expense/budget actual, USD `500` wallet outflow, LBP `110000` wallet inflow, and zero reconciliation difference for both wallets.
- [ ] **Step 3: Extend workbook tests** so transaction/item sheets format the LBP cost while wallet-ledger rows format USD tender and LBP change independently.
- [ ] **Step 4: Run** `pnpm exec vitest run src/components/transactions/cash-settlement-summary.test.tsx src/features/export/schedules.test.ts src/features/export/workbook.test.ts` and confirm RED.
- [ ] **Step 5: Split summary currency props** into cost and tender currencies, keep the primary Activity/detail amount cost-based, and add the compact payment/change secondary line without combining currencies.
- [ ] **Step 6: Update export ledger construction** to use `settlement.tenderCurrency` for payer outflow while monthly operating expense and budget actuals continue using effective transaction cost currency.
- [ ] **Step 7: Run the targeted tests** from Step 4 and confirm GREEN.
- [ ] **Step 8: Commit** display/export changes with message `feat: report cost separately from cashier cash`.

### Task 6: End-to-end coverage, documentation, and full verification

**Files:**
- Modify: `e2e/cashier.spec.ts`
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: the completed feature.
- Produces: bilingual browser coverage and durable documentation of cost versus physical cash semantics.

- [ ] **Step 1: Add bilingual Playwright coverage** that enters/reopens LBP `340000` cost, USD `5` tender, and LBP `110000` change; verifies no rate control/calculated amount; verifies detail/activity amounts; duplicates the entry; and checks mobile horizontal overflow.
- [ ] **Step 2: Run** `pnpm exec playwright test e2e/cashier.spec.ts` and fix only feature-related failures until GREEN.
- [ ] **Step 3: Update product/architecture docs** to state that purchase currency may differ from payer currency only with cashier settlement, reporting uses cost, balances use actual tender/change, and no rate is inferred.
- [ ] **Step 4: Run focused suites**: all transaction, composer, export, message, database, concurrency, and cashier E2E tests added above.
- [ ] **Step 5: Run full verification**: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm db:test`, and `pnpm exec playwright test`.
- [ ] **Step 6: Run** `git diff --check` and `git status --short`; inspect every changed file and preserve unrelated user changes.
- [ ] **Step 7: Commit** documentation/E2E changes with message `docs: describe cross-currency purchase costs`.
