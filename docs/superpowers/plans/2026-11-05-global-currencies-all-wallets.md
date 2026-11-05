# Global Currencies in Every Wallet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every enabled account currency automatically and atomically available in every non-deleted wallet while preserving exact balances, per-wallet defaults, history, Move/Exchange behavior, and safe deletion.

**Architecture:** A new forward PostgreSQL migration replaces per-wallet currency attachment with an owner-serialized global coverage invariant and RPC-only invariant-bearing writes. Application queries/provider retain complete historical identities but expose enabled balances for ordinary use; the selected Currency-view UI shows one global currency across ordered wallets, while exact balance IDs remain the only monetary references.

**Tech Stack:** Next.js 16.4 App Router, React 19, TypeScript, Supabase/PostgreSQL 17, pgTAP, Vitest/Testing Library, Playwright, next-intl, dnd-kit.

**Spec:** `docs/superpowers/specs/2026-11-05-global-currencies-all-wallets-design.md`

## Global Constraints

- Read the relevant `node_modules/next/dist/docs/` guide before each Next.js task, as required by `AGENTS.md`.
- Work on `main` as explicitly requested; never rewrite the committed `20261123000000_custom_currencies_multi_wallets.sql` migration.
- Every enabled currency has exactly one durable balance in every non-deleted wallet, including Needs-attention wallets.
- Disabled balances remain zero, hidden from ordinary selectors, historically resolvable, and keep the same UUID when re-enabled.
- Catalog order is `currencies.created_at, code`; no combined multi-currency wallet total or automatic value conversion exists.
- **Move** means different wallets; **Exchange** means different enabled balances inside one wallet.
- All monetary writes use exact balance IDs and runtime currency definitions with 0–8 decimal places.
- Stable currency/wallet/balance errors are exposed; raw database details are never shown.
- Never write the supplied cloud database during implementation; use only the disposable PostgreSQL 17 fixture.
- Preserve the current uncommitted interrupted Task 4 files without staging them in Tasks 1–2: `currencies-manager*`, `currency-sheet.tsx`, and EN/AR messages. Task 3 owns their reconciliation.
- Before overall completion, remove only the exact disposable SSH workspaces/containers/databases created for this feature.

## Review Focus

- Currency creation racing wallet creation must leave complete coverage or roll back; Task 1 adds a deterministic two-connection test.
- An auto-created zero balance must not mark a definition used, while first money/history/configuration use must be irreversible; Task 1 adds pgTAP lifecycle tests.
- Disable/delete/default switching across Needs-attention and tombstoned wallets must not corrupt history; Tasks 1 and 7 test both states.
- Refreshed server props after currency add/edit/delete must update the open settings manager without stale rows; Task 3 adds integration tests.
- The global Currency-view selector must never hide a wallet, guess a balance, or combine values when catalog state changes; Task 4 adds component and E2E tests.

---

### Task 1: Enforce global currency coverage in PostgreSQL

**Files:**
- Create: `supabase/migrations/20261124000000_global_currencies_all_wallets.sql`
- Create: `supabase/tests/global_currencies_all_wallets.test.sql`
- Create: `supabase/tests/global-currencies-concurrency.mjs`
- Modify: `supabase/tests/user_currencies_multi_wallets.test.sql`
- Modify: `supabase/tests/multi-wallet-concurrency.mjs`
- Modify: `supabase/tests/multi-wallet-migration.mjs`
- Modify: `src/lib/supabase/database.types.ts`

**Interfaces:**
- Consumes existing catalog, wallet/balance tables, `record_balance_transfer`, settlement/deletion, and owner-lock ordering.
- Produces `create_currency(p_code text,p_symbol text,p_decimal_places integer)`, `update_currency(p_current_code text,p_code text,p_symbol text,p_decimal_places integer)`, `delete_currency(p_code text)`, revised `set_currency_disabled(p_code text,p_disabled boolean)`, and revised `create_wallet(p_name text,p_kind wallet_kind,p_default_currency text,p_opening_minor bigint default 0)`.
- Retains `set_wallet_default(wallet,balance)` and removes authenticated execution of `add_wallet_balance`/`detach_wallet_balance`.

- [ ] **Step 1: Write failing global-coverage pgTAP tests**

Assert backfill of every enabled currency into every non-deleted/Needs-attention wallet, preservation of existing UUIDs/amounts/defaults/history, no new tombstone rows, global catalog order, enabled detach normalization, and default validity.

- [ ] **Step 2: Run the new pgTAP file and verify RED**

Run: `pnpm db:test`

Expected: FAIL because coverage, RPCs, and used-state semantics are absent.

- [ ] **Step 3: Implement the forward migration and RPC boundary**

Use one owner lock before catalog/wallet/balance locks; backfill zero rows; normalize positions; add an internal transaction-scoped Needs-attention capability; revoke/guard direct invariant-breaking catalog and wallet creation; make auto zero rows use-neutral.

- [ ] **Step 4: Add lifecycle pgTAP tests and make them GREEN**

Cover add/edit/delete, first-use irreversibility, zero return, disable blockers, cyclic default switch, re-enable same IDs, unused deletion including empty tombstone rows, last-enabled rejection, and wallet creation with all enabled balances/opening only on default.

Run: `pnpm db:test`

Expected: all suites PASS.

- [ ] **Step 5: Write deterministic concurrency RED/GREEN tests**

Cover add vs wallet create/delete, enable vs wallet create, delete vs first use, disable vs new money, and default switch vs catalog change using lock barriers rather than sleeps.

Run: the new script plus existing multi-wallet/reference concurrency scripts against the explicit disposable fixture.

Expected: every race has one serializable invariant-preserving outcome.

- [ ] **Step 6: Rehearse populated migration and regenerate types**

Run: populated replay, `pnpm db:types`, `pnpm db:test`, concurrency scripts, `pnpm typecheck`, and `pnpm test`.

Expected: preservation assertions and all regression suites PASS; generated types expose the revised RPCs and no per-wallet lifecycle RPC use.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261124000000_global_currencies_all_wallets.sql supabase/tests src/lib/supabase/database.types.ts
git commit -m "feat: apply global currencies to every wallet"
```

### Task 2: Revise global currency and wallet data access

**Files:**
- Modify: `src/features/currencies/actions.ts`
- Modify: `src/features/currencies/actions.test.ts`
- Modify: `src/features/currencies/queries.ts`
- Modify: `src/features/wallets/actions.ts`
- Modify: `src/features/wallets/actions.test.ts`
- Modify: `src/features/wallets/queries.ts`
- Modify: `src/features/wallets/queries.test.ts`
- Modify: `src/features/wallets/schema.ts`
- Modify: `src/lib/demo-data.ts`
- Modify: `src/lib/supabase/action.ts`

**Interfaces:**
- Consumes Task 1 RPCs and generated types.
- Produces RPC-backed global catalog actions; removes `addWalletBalance` and `detachWalletBalance`.
- Produces `getWallets({ includeDeleted?, includeNeedsAttention?, includeDisabledBalances? })`, defaulting to active wallets with enabled balances only.

- [ ] **Step 1: Write failing query tests**

Assert every ordinary wallet has exactly the enabled catalog set in catalog order, disabled balances appear only with `includeDisabledBalances`, deleted/Needs-attention options remain independent, and missing/duplicate/cross-wired coverage fails closed. Mirror all cases in demo mode.

- [ ] **Step 2: Run query tests and verify RED**

Run: `pnpm vitest run src/features/currencies src/features/wallets/queries.test.ts`

Expected: FAIL on per-wallet attachment and balance-position assumptions.

- [ ] **Step 3: Implement catalog-ordered global wallet mapping**

Validate complete enabled coverage; retain exact disabled identities only when requested; never synthesize a row or fallback definition.

- [ ] **Step 4: Write failing action tests**

Assert exact revised RPC arguments/results for create/update/delete/enable/disable currency and create wallet; assert no exported add/detach actions; assert normalization, stable errors, success-only layout revalidation, and all-enabled demo wallet creation.

- [ ] **Step 5: Implement actions and run GREEN verification**

Run: focused tests, `pnpm typecheck`, `pnpm test`, scoped ESLint.

Expected: all PASS.

- [ ] **Step 6: Commit without staging Task 3's preserved dirty files**

```bash
git add src/features/currencies/actions.ts src/features/currencies/actions.test.ts src/features/currencies/queries.ts src/features/wallets src/lib/demo-data.ts src/lib/supabase/action.ts
git commit -m "feat: use global currency wallet data access"
```

### Task 3: Finish runtime provider and global currency settings

**Files:**
- Modify: `src/components/providers/app-data.tsx`
- Modify: `src/components/providers/app-data.test.tsx`
- Modify: `src/components/currencies/currencies-manager.tsx`
- Modify: `src/components/currencies/currencies-manager.test.tsx`
- Create/finish: `src/components/currencies/currencies-manager-mutations.test.tsx`
- Modify: `src/components/currencies/currency-sheet.tsx`
- Modify: `src/components/currencies/currency-sheet.test.tsx`
- Modify: `src/messages/en.json`
- Modify: `src/messages/ar.json`
- Modify: `src/app/[locale]/(app)/settings/currencies/page.tsx`

**Interfaces:**
- Consumes Task 2 global actions/queries.
- Produces canonical complete-history indexes plus ordinary enabled balance views and a refreshed global settings manager.

- [ ] **Step 1: Re-run the interrupted review RED tests**

Assert successful create/edit/delete immediately reconcile visible manager rows after refreshed props; Arabic edit/delete/disable titles isolate codes with `<bdi dir="ltr">`.

- [ ] **Step 2: Add failing global-application UI tests**

Assert copy says a currency applies to every wallet, add/enable refreshes all canonical wallet coverage, disable preview lists global blockers, re-enable keeps defaults, and last-enabled protection remains.

- [ ] **Step 3: Reconcile preserved edits and implement global settings behavior**

Use server-refreshed props as authority; do not duplicate optimistic rows. Keep failed sheets open and use React-node titles with bidi-isolated code.

- [ ] **Step 4: Run focused/full verification**

Run: provider/currency component tests, `pnpm typecheck`, `pnpm test`, scoped ESLint, message parity, `git diff --check`.

Expected: all PASS and no stale manager rows.

- [ ] **Step 5: Commit**

```bash
git add src/components/providers src/components/currencies 'src/app/[locale]/(app)/settings/currencies/page.tsx' src/messages/en.json src/messages/ar.json
git commit -m "feat: finish global currency settings"
```

### Task 4: Build the selected Currency-view wallet experience

**Files:**
- Rewrite: `src/components/wallets/wallets-view.tsx`
- Rewrite: `src/components/wallets/wallet-sheet.tsx`
- Modify: `src/components/wallets/wallet-select.tsx`
- Create: `src/components/wallets/currency-selector.tsx`
- Create: `src/components/wallets/currency-selector.test.tsx`
- Create: `src/components/wallets/wallets-view.test.tsx`
- Modify: `src/components/money/amount.tsx`
- Modify: `src/components/home/home-view.tsx`
- Modify: `src/components/shell/composer.tsx`
- Modify: `e2e/currency.spec.ts`

**Interfaces:**
- Consumes Task 3 enabled catalog and exact balance indexes.
- Produces a global selected-currency state, one exact amount per wallet card, and wallet edit/create UI with default selection only.

- [ ] **Step 1: Write failing Currency-view tests**

Assert one global enabled-currency selector; all active wallets remain visible; each card resolves the exact selected balance; no combined total; default marker; custom 8-decimal formatting; disabled currency absent; Needs-attention separate; RTL/320px behavior.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run src/components/wallets src/components/money`

Expected: FAIL on the old per-wallet/currency rendering.

- [ ] **Step 3: Implement Currency-view and wallet sheets**

New wallet defaults to the first catalog currency but permits another enabled default; show no add/detach controls; changing selected display currency does not change wallet defaults.

- [ ] **Step 4: Run component and E2E verification**

Run: focused tests and `pnpm playwright test e2e/currency.spec.ts` in both locales.

Expected: PASS without overflow or guessed balances.

- [ ] **Step 5: Commit**

```bash
git add src/components/wallets src/components/money/amount.tsx src/components/home/home-view.tsx src/components/shell/composer.tsx e2e/currency.spec.ts
git commit -m "feat: add global currency wallet view"
```

### Task 5: Add accessible global wallet ordering

**Files:**
- Create: `src/features/wallets/reorder.ts`
- Create: `src/features/wallets/reorder.test.ts`
- Create: `src/components/wallets/wallet-reorder.tsx`
- Create: `src/components/wallets/wallet-reorder.test.tsx`
- Modify: `src/components/wallets/wallets-view.tsx`
- Modify: `src/features/wallets/actions.ts`
- Modify: `e2e/currency.spec.ts`

**Interfaces:**
- Produces `reorderWallets(ids: string[]): Promise<ActionResult>` backed by the complete active-list RPC; every currency view and selector uses the same wallet order.

- [ ] **Step 1: Write reorder domain/action/component RED tests**

Cover duplicate/missing/foreign IDs, exact order, create append, delete compaction, error recovery, pointer/keyboard movement, and order persistence across currency selection.

- [ ] **Step 2: Implement reorder domain/action/UI**

Mirror existing category dnd-kit semantics with labeled keyboard controls.

- [ ] **Step 3: Run focused and E2E tests**

Run: wallet reorder tests and `e2e/currency.spec.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/features/wallets src/components/wallets e2e/currency.spec.ts
git commit -m "feat: add wallet ordering"
```

### Task 6: Implement exact-balance Move and Exchange flows

**Files:**
- Modify: `src/features/transactions/schema.ts`
- Modify: `src/features/transactions/mutation-input.ts`
- Modify: `src/features/transactions/mutations-core.ts`
- Modify: `src/features/transactions/queries.ts`
- Modify: `src/features/transactions/settlement*.ts`
- Modify: matching transaction tests
- Rewrite: `src/components/add/transaction-sheet.tsx`
- Create: `src/components/add/balance-picker.tsx`
- Create: `src/components/add/balance-picker.test.tsx`
- Modify: `src/components/transactions/{transaction-row,detail-sheet,activity-view}.tsx`
- Modify: `src/messages/en.json`
- Modify: `src/messages/ar.json`
- Modify: `e2e/move.spec.ts`

**Interfaces:**
- Produces exact `sourceBalanceId`, `destinationBalanceId`, `sentMinor`, `receivedMinor` input and `classifyBalanceTransfer(source,destination): "move" | "exchange"`.

- [ ] **Step 1: Write classification/validation/picker RED tests**

Assert different-wallet same/cross currency are Move, same-wallet different currency is Exchange, same balance rejects, every active wallet is destination-eligible for every enabled currency, disabled history is unavailable, defaults preselect, and custom precision resets inputs.

- [ ] **Step 2: Implement exact-balance schemas, queries, mutations, picker, and terminology**

Never create a destination balance during the operation; resolve the guaranteed existing exact row.

- [ ] **Step 3: Run unit/component/E2E verification**

Run transaction/add/activity tests and `pnpm playwright test e2e/move.spec.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/features/transactions src/components/add src/components/transactions src/messages/en.json src/messages/ar.json e2e/move.spec.ts
git commit -m "feat: add wallet moves and internal exchanges"
```

### Task 7: Complete guided wallet deletion and durable history

**Files:**
- Create: `src/features/wallets/deletion.ts`
- Create: `src/features/wallets/deletion.test.ts`
- Modify: `src/features/wallets/actions.ts`
- Create: `src/components/wallets/wallet-delete-sheet.tsx`
- Create: `src/components/wallets/wallet-delete-sheet.test.tsx`
- Modify: `src/components/wallets/wallet-sheet.tsx`
- Modify: `src/features/transactions/queries.ts`
- Modify: `src/features/export/model.ts`
- Modify: `src/messages/en.json`
- Modify: `src/messages/ar.json`
- Create: `e2e/wallet-deletion.spec.ts`

**Interfaces:**
- Produces `WalletDeletionPlan`, `inspectWalletDeletion(walletId)`, and idempotent `settleAndDeleteWallet(requestId,walletId,settlements)` with exact universal same-currency counterpart balances.

- [ ] **Step 1: Write deletion-plan/sheet RED tests**

Cover zero deletion, positive outgoing, negative incoming, multiple enabled currencies, default/nondefault balances, eligible ordered counterparts, dependencies, Needs-attention, no counterpart, retry, and full rollback.

- [ ] **Step 2: Implement inspection/action/guided sheet**

User selects one other wallet per non-zero currency; resolve its guaranteed exact balance ID; submit one atomic request.

- [ ] **Step 3: Add historical immutability tests and implementation**

Keep tombstoned wallet/currency/balance identity visible; hide monetary controls; reject stale writes; allow only approved metadata corrections.

- [ ] **Step 4: Run unit/component/E2E tests and commit**

Run wallet/transaction/export tests plus `e2e/wallet-deletion.spec.ts`.

```bash
git add src/features/wallets src/components/wallets src/features/transactions/queries.ts src/features/export/model.ts src/messages/en.json src/messages/ar.json e2e/wallet-deletion.spec.ts
git commit -m "feat: add safe wallet deletion"
```

### Task 8: Migrate every remaining money feature to runtime balances

**Files:**
- Modify: `src/features/budgets/schema.ts`
- Modify: `src/features/budgets/queries.ts`
- Modify: `src/components/budget/budgets-sheet.tsx`
- Modify: `src/components/budget/budgets-view.tsx`
- Modify: `src/components/fixed/fixed-sheet.tsx`
- Modify: `src/components/fixed/fixed-card.tsx`
- Modify: `src/features/installments/schema.ts`
- Modify: `src/features/installments/actions.ts`
- Modify: `src/features/installments/cycle-queries.ts`
- Modify: `src/components/installments/installment-sheet.tsx`
- Modify: `src/components/installments/installment-pay-sheet.tsx`
- Modify: `src/features/salary/schema.ts`
- Modify: `src/features/salary/actions.ts`
- Modify: `src/components/salary/salary-sheet.tsx`
- Modify: `src/features/loans/schema.ts`
- Modify: `src/features/loans/actions.ts`
- Modify: `src/features/loans/queries.ts`
- Modify: `src/components/loans/loan-sheet.tsx`
- Modify: `src/components/loans/loan-payment-sheet.tsx`
- Modify: `src/features/pending-payments/schema.ts`
- Modify: `src/features/pending-payments/actions.ts`
- Modify: `src/features/pending-payments/queries.ts`
- Modify: `src/components/pending-payments/payment-sheet.tsx`
- Modify: `src/components/pending-payments/receipt-sheet.tsx`
- Modify: `src/components/add/cash-settlement-fields.tsx`
- Modify: `src/components/add/expense-breakdown-fields.tsx`
- Modify: matching tests in every listed feature/component directory
- Modify: `e2e/budgets.spec.ts`
- Modify: `e2e/fixed.spec.ts`
- Modify: `e2e/installments.spec.ts`
- Modify: `e2e/salary.spec.ts`
- Modify: `e2e/loans.spec.ts`
- Modify: `e2e/pending-payments.spec.ts`
- Modify: `e2e/cashier.spec.ts`
- Modify: `e2e/expense-breakdowns.spec.ts`

**Interfaces:**
- Consumes exact balance/provider APIs from Tasks 2–6.
- Produces no live `wallet.currency`, wallet-level amount, fixed registry, or per-wallet availability assumption.

- [ ] **Step 1: Add RED tests per feature family**

For each family assert custom precision, enabled global currency availability in every wallet, wallet default preselection, exact balance write, disabled historical display, and disabled new-write rejection.

- [ ] **Step 2: Migrate feature families one at a time**

Keep historical currency snapshots; derive every new write from the selected exact balance.

- [ ] **Step 3: Run all focused feature tests and E2E regressions**

Expected: all PASS in English/Arabic.

- [ ] **Step 4: Commit exact touched files only**

```bash
git commit -m "feat: use global currency balances across money features"
```

### Task 9: Export runtime catalog, wallets, and balances

**Files:**
- Modify: `src/features/export/{data,model,schedules,workbook}.ts`
- Modify: matching export tests
- Modify: `src/app/[locale]/(app)/settings/export/route.ts`

**Interfaces:**
- `ExportData` carries the complete catalog and exact wallet/balance identities; numeric spreadsheet values use configured precision and never combine currencies.

- [ ] **Step 1: Write export RED tests**

Cover 8-decimal scaling, Unicode symbols, disabled history, tombstones, exact balance IDs, global catalog order, and no combined wallet total/fallback.

- [ ] **Step 2: Refactor export loading/workbook and run GREEN tests**

Run: `pnpm vitest run src/features/export && pnpm typecheck`.

- [ ] **Step 3: Commit**

```bash
git add src/features/export 'src/app/[locale]/(app)/settings/export/route.ts'
git commit -m "feat: export global currency wallet balances"
```

### Task 10: Remove compatibility and verify the complete product

**Files:**
- Modify: `src/lib/currency.ts`, `src/lib/money.ts`, `src/lib/demo-data.ts`
- Modify: `src/app/[locale]/dev/kitchen-sink/kitchen-sink.tsx`
- Modify: `README.md`, `PRODUCT.md`, `DESIGN.md`
- Create/modify: currency lifecycle, Move, deletion, and smoke E2E specs
- Modify: every live file returned by compatibility searches

**Interfaces:**
- Removes fixed currency unions/maps, legacy wallet arrays/lookups, temporary money overloads, per-wallet add/detach APIs, and wallet-level accounting assumptions.

- [ ] **Step 1: Add final lifecycle E2E RED**

Cover BTC add auto-appearing in all wallets, new wallet receiving every enabled currency, global Currency view, defaults, same-wallet Exchange, cross-wallet Move, order, disable blockers/switch, re-enable same IDs, unused deletion, positive/negative wallet deletion, history, both locales, and 320px overflow.

- [ ] **Step 2: Remove all compatibility paths**

Run and clear live hits:

```bash
rg 'CURRENCIES|CURRENCY_DECIMALS|currencyPrefix\(|type Currency\b|wallet\.currency|wallet\.balanceMinor|getLegacyWallets|legacyWallets|legacyWalletById|addWalletBalance|detachWalletBalance' src --glob '!**/*.test.*'
```

- [ ] **Step 3: Update documentation and kitchen sink**

Document global catalog coverage, Currency view, defaults, Move/Exchange, ordering, disabling, deletion, precision, and no combined totals.

- [ ] **Step 4: Run full static/unit/database/concurrency verification**

Run: `pnpm lint && pnpm typecheck && pnpm test`, `pnpm db:test`, all gated concurrency scripts, and populated migration replay.

Expected: all PASS; HTTP-only suites may skip only with the already documented absent API/JWT fixture.

- [ ] **Step 5: Run full E2E/build and inspect cleanup searches**

Run: `pnpm test:e2e && pnpm build`, `git diff --check`, the Step 2 search, and `git status --short`.

- [ ] **Step 6: Clean the remote disposable runtime**

Stop/remove only containers, networks, volumes, rehearsal databases, and the exact SSH workspace created for this feature. Prove unrelated containers remain untouched.

- [ ] **Step 7: Commit**

```bash
git add src supabase e2e README.md PRODUCT.md DESIGN.md
git commit -m "feat: complete global currency wallets"
```
