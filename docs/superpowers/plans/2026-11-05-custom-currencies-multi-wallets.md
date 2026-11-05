# Custom Currencies and Multi-Currency Wallets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-defined currencies and convert wallets into ordered containers with independent currency balances, safe Move/Exchange flows, guided deletion, and preserved financial history.

**Architecture:** A tenant-owned `currencies` catalog defines precision and display. `wallets` becomes the ordered container while `wallet_balances` becomes the stable accounting identity referenced by every monetary leg; all existing data moves through one forward, atomic migration without rescaling amounts.

**Tech Stack:** Next.js 16.4 App Router, React 19, TypeScript, next-intl, Zod 4, Supabase/PostgreSQL 17 with RLS and pgTAP, dnd-kit, Vitest/Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-custom-currencies-multi-wallets-design.md`

## Global Constraints

- Read the relevant guides under `node_modules/next/dist/docs/` before each Next.js change; mutations must follow `01-app/01-getting-started/07-mutating-data.md` and `01-app/02-guides/server-actions.md`.
- Currency codes match `^[A-Z][A-Z0-9]{0,11}$`; symbols contain 1-12 Unicode code points; decimal places are integers from 0 through 8.
- Keep `MAX_MINOR = 1_000_000_000_000_000`; scaling, comparisons, and sums use integer/`BigInt` arithmetic.
- Existing USD/LBP/SYP amounts are never rescaled and migrate as `$`/2, `LBP`/0, and `SYP`/0.
- A wallet is a container; every monetary write identifies exact source/target `wallet_balance` rows.
- An active wallet always has at least one attached, enabled balance and one valid default balance.
- Never create or restore a destination balance implicitly during Move, Exchange, cashier change, funding, or deletion.
- **Move** is between different wallets; **Exchange** is between different balances in the same wallet. Use those terms consistently in English, Arabic, Activity, and accessible names.
- Wallet deletion and currency disabling never erase history or leave money stranded.
- Do not rewrite historical migrations; create one forward-only combined migration and regenerate Supabase types.
- Every behavior change follows red-green-refactor and every task ends with focused verification and a commit.

## Review Focus

- A negative card balance being deleted must settle by moving money into it, not by attempting an impossible outgoing transfer; Task 8 pins both signs.
- A disabled currency or tombstoned wallet must reject any later historical mutation that would make a balance non-zero while permitting metadata-only corrections; Task 2 pins database enforcement.
- An existing archived wallet with money must stay hidden but resolvable under **Needs attention**, never silently reactivate or disappear; Tasks 2 and 5 pin migration/UI behavior.
- An Exchange must allow two balances in the same wallet while rejecting the same balance or same currency; Task 7 pins classification and validation.
- Reorder racing with create/delete must yield a dense, duplicate-free order and never lose a wallet; Task 6 pins deterministic concurrency.

---

### Task 1: Runtime currency, wallet, and balance domain model

**Files:**
- Create: `src/features/currencies/schema.ts`
- Create: `src/features/currencies/schema.test.ts`
- Modify: `src/lib/currency.ts`
- Modify: `src/lib/currency.test.ts`
- Modify: `src/lib/money.ts`
- Modify: `src/lib/money.test.ts`
- Modify: `src/features/wallets/schema.ts`
- Modify: `src/features/wallets/schema.test.ts`
- Modify: `src/features/wallets/totals.ts`

**Interfaces:**
- Produces `CurrencyDefinition { code, symbol, decimalPlaces, disabled, firstUsed }`, `CurrencyInput`, `DEFAULT_CURRENCIES`, `currencyInputSchema`, `indexCurrencies`, `requireCurrency`, and `enabledCurrencies`.
- Changes `parseAmount(input, definition)`, `formatAmount(minor, definition, options)`, and `toInputText(minor, definition)` to consume a definition; temporary built-in overloads remain until Task 11.
- Produces `WalletBalance { id, walletId, currency, openingBalanceMinor, balanceMinor, position, detached }` and `Wallet { id, name, kind, position, deleted, needsAttention, defaultBalanceId, balances }`.
- Produces `attachedBalances(wallet, definitions)`, `defaultBalance(wallet, definitions)`, `nextDefaultBalance(wallet, disabledCode, definitions)`, and `totalsByCurrency(wallets, definitions)`.

- [ ] **Step 1: Write failing currency and money tests**

Create tests named `normalizes and validates custom definitions`, `formats runtime precision without floating point`, and `separates letter and symbol prefixes` with these core assertions:

```ts
expect(currencyInputSchema.parse({ code: " btc ", symbol: "₿", decimalPlaces: 8 }).code).toBe("BTC");
expect(parseAmount("0.00000001", btc)).toBe(1);
expect(formatAmount(1, btc)).toBe("₿0.00000001");
expect(formatAmount(1250, lbp)).toBe("LBP 1,250");
expect(parseAmount("10000000.00000001", btc)).toBeNull();
```

- [ ] **Step 2: Run the currency tests and verify RED**

Run: `pnpm vitest run src/features/currencies/schema.test.ts src/lib/currency.test.ts src/lib/money.test.ts`

Expected: FAIL because runtime definitions and precision-aware helpers do not exist.

- [ ] **Step 3: Implement runtime currency definitions and money helpers**

Use `BigInt(10) ** BigInt(decimalPlaces)` for scaling and `Array.from(symbol).length` for the app-side Unicode code-point bound. Preserve Arabic digits, exact configured fractional display, and the approved prefix-spacing rule.

- [ ] **Step 4: Write failing wallet/balance model tests**

Create tests named `selects an enabled attached default`, `chooses the next default cyclically`, and `totals balance rows by runtime currency`:

```ts
expect(defaultBalance(pocket, currencies).id).toBe("usd-balance");
expect(nextDefaultBalance(pocket, "USD", currencies)?.id).toBe("lbp-balance");
expect(totalsByCurrency([pocket], currencies)).toEqual({ USD: 1250, LBP: 4_250_000 });
```

Also assert that missing definitions, detached defaults, disabled defaults, duplicate balance currencies, and cross-wallet default IDs throw/parse-fail visibly.

- [ ] **Step 5: Run wallet model tests and verify RED**

Run: `pnpm vitest run src/features/wallets/schema.test.ts`

Expected: FAIL on the old one-currency `Wallet` shape.

- [ ] **Step 6: Implement the wallet/balance schemas and pure helpers**

Keep pure helpers free of React and Supabase so every UI/query layer can reuse identical default, ordering, and totals behavior.

- [ ] **Step 7: Run focused and full unit tests**

Run: `pnpm vitest run src/features/currencies src/lib/currency.test.ts src/lib/money.test.ts src/features/wallets/schema.test.ts && pnpm test`

Expected: PASS; temporary compatibility overloads keep untouched callers green.

- [ ] **Step 8: Commit**

```bash
git add src/features/currencies src/lib/currency.ts src/lib/currency.test.ts src/lib/money.ts src/lib/money.test.ts src/features/wallets/schema.ts src/features/wallets/schema.test.ts src/features/wallets/totals.ts
git commit -m "feat: model runtime currencies and wallet balances"
```

### Task 2: Atomic database migration and monetary invariants

**Files:**
- Create: `supabase/migrations/20261123000000_custom_currencies_multi_wallets.sql`
- Create: `supabase/tests/user_currencies_multi_wallets.test.sql`
- Create: `supabase/tests/multi-wallet-concurrency.mjs`
- Modify: `supabase/tests/currency.test.sql`
- Modify: `supabase/tests/multiple_cashier_changes.test.sql`
- Modify: `supabase/tests/loans.test.sql`
- Modify: `supabase/tests/pending_payments.test.sql`
- Modify: `supabase/tests/budgets.test.sql`
- Create: `src/lib/supabase/database.types.ts`

**Interfaces:**
- Produces `public.currencies`, container-style `public.wallets`, and `public.wallet_balances` exactly as specified.
- Produces `public.wallet_balance_totals` and updates every ledger view/RPC to exact balance IDs.
- Produces private helpers `lock_currency_definition(user_id, code, require_enabled)` and `lock_wallet_balance(user_id, balance_id, require_active)` (SQL names may be prefixed consistently but signatures/semantics remain).
- Produces stable database errors beginning `currency.`, `wallet.`, and `balance.` for action mapping.
- Converts all `public.currency` columns, parameters, and returns to validated text, then drops the enum.

- [ ] **Step 1: Write failing pgTAP migration tests**

Assert default currency bootstrap, exact USD/LBP/SYP metadata, one backfilled balance per existing wallet, preserved opening/current amounts, preserved defaults/order, transaction source/destination/change backfill, archived zero-wallet tombstoning, archived non-zero **Needs attention**, text-based currency columns, RLS isolation, and no orphan balance references. In the same test file, cover invalid/foreign defaults, duplicate wallet currency, disabled/detached monetary writes, same-wallet Exchange, cross-wallet Move, same-balance rejection, same-currency unequal rejection, detach only at zero, tombstone only at zero, global disable blockers/default switching, negative settlement direction, and post-disable/post-tombstone mutation rules.

Core assertions include:

```sql
select is((select count(*) from public.wallet_balances where wallet_id = :legacy_wallet), 1::bigint);
select is((select balance_minor from public.wallet_balance_totals where balance_id = :legacy_balance), :legacy_amount);
select is((select currency from public.wallet_balances where id = :legacy_balance), 'USD');
select throws_ok($$select public.record_balance_transfer(...same_balance...)$$, '22023', 'balance.same');
select lives_ok($$select public.record_balance_transfer(...same_wallet_usd..., ...same_wallet_lbp...)$$);
select throws_ok($$update public.transactions set deleted_at = now() where id = :touches_deleted_wallet$$, 'P0001', 'wallet.deleted');
```

- [ ] **Step 2: Run pgTAP and verify RED**

Run: `pnpm db:test`

Expected: FAIL because the catalog, balance table, and migrated RPC signatures do not exist.

- [ ] **Step 3: Implement the dependency-safe forward migration**

Backfill definitions and balances before constraints; rebuild functions/views/triggers/RPCs; migrate replay payload validation; preserve snapshots; add composite ownership checks; then remove obsolete wallet columns and the enum. Use deferrable constraints where wallet/default-balance insertion forms a cycle.

- [ ] **Step 4: Run pgTAP and verify GREEN**

Run: `pnpm db:test`

Expected: all existing and new database suites PASS.

- [ ] **Step 5: Write deterministic two-connection tests**

Cover first currency use versus edit/delete, disable versus new money, transfer versus detach, new reference versus tombstone, default change versus detach, and reorder versus create/delete using lock barriers rather than sleeps.

- [ ] **Step 6: Run concurrency tests and verify RED**

Run the new script with the same explicit disposable PostgreSQL 17 environment gates as `currency-references-concurrency.mjs`.

Expected: FAIL on missing/conflicting final lock ordering.

- [ ] **Step 7: Implement deterministic row and owner lock ordering**

Use ordered catalog, wallet, and balance row locks plus one owner-scoped reorder lock; retry nothing inside the database function and leave transactions atomic on conflict.

- [ ] **Step 8: Regenerate types and run database/static verification**

Run: the gated concurrency script, then `pnpm db:types && pnpm db:test && pnpm typecheck`.

Expected: concurrency and pgTAP suites PASS; generated types expose catalog/container/balance/RPC rows and no live enum type.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20261123000000_custom_currencies_multi_wallets.sql supabase/tests src/lib/supabase/database.types.ts
git commit -m "feat: migrate to multi-currency wallet balances"
```

### Task 3: Currency, wallet, and balance data access

**Files:**
- Create: `src/features/currencies/queries.ts`
- Create: `src/features/currencies/queries.test.ts`
- Create: `src/features/currencies/actions.ts`
- Create: `src/features/currencies/actions.test.ts`
- Rewrite: `src/features/wallets/queries.ts`
- Modify: `src/features/wallets/queries.test.ts`
- Rewrite: `src/features/wallets/actions.ts`
- Create: `src/features/wallets/actions.test.ts`
- Modify: `src/lib/supabase/action.ts`
- Modify: `src/lib/demo-data.ts`

**Interfaces:**
- Produces cached `getCurrencies(): Promise<CurrencyDefinition[]>` and `getWallets(options?: { includeDeleted?: boolean; includeNeedsAttention?: boolean }): Promise<Wallet[]>`; the default returns active wallets only.
- Produces currency actions `createCurrency(input: CurrencyInput)`, `updateCurrency(currentCode: string, input: CurrencyInput)`, `inspectCurrencyDisable(code: string): Promise<CurrencyDisableBlocker[]>`, `setCurrencyEnabled(code: string, enabled: boolean)`, and `deleteCurrency(code: string)`.
- Produces wallet actions `createWallet(input: WalletCreateInput)`, `updateWallet(id: string, input: WalletUpdateInput)`, `addWalletBalance(walletId: string, input: WalletBalanceInput)`, `setDefaultWalletBalance(walletId: string, balanceId: string)`, and `detachWalletBalance(balanceId: string)`.
- Produces `CurrencyDisableBlocker` and stable `ActionError` variants for all spec errors.

- [ ] **Step 1: Write failing query tests**

Assert custom row mapping, catalog order, nested balance order, current-balance mapping, exact default resolution, malformed/missing definition failure, deleted exclusion, **Needs attention** inclusion, and unconfigured demo defaults.

- [ ] **Step 2: Run query tests and verify RED**

Run: `pnpm vitest run src/features/currencies/queries.test.ts src/features/wallets/queries.test.ts`

Expected: FAIL because queries still expect one currency per wallet.

- [ ] **Step 3: Implement cached catalog and nested-wallet queries**

Validate every returned currency against the request catalog. Never fall back to USD or infer a missing default.

- [ ] **Step 4: Write failing action tests**

Assert normalization (`" usd " → "USD"`), duplicate mapping, structured disable blockers, ownership/auth failures, exact balance IDs, reactivation-at-zero, no opening amount on restored balance, successful layout revalidation, and known/unknown error mapping.

- [ ] **Step 5: Run action tests and verify RED**

Run: `pnpm vitest run src/features/currencies/actions.test.ts src/features/wallets/actions.test.ts`

Expected: FAIL because RPC-backed actions do not exist.

- [ ] **Step 6: Implement authenticated actions and error types**

All actions validate with Task 1 schemas, call Task 2 RPCs, expose only stable errors/blockers, and revalidate `"/", "layout"` on success.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `pnpm vitest run src/features/currencies src/features/wallets && pnpm typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/currencies src/features/wallets src/lib/supabase/action.ts src/lib/demo-data.ts
git commit -m "feat: add currency and wallet balance data access"
```

### Task 4: App catalog provider and currency settings

**Files:**
- Modify: `src/app/[locale]/(app)/layout.tsx`
- Modify: `src/components/providers/app-data.tsx`
- Create: `src/components/providers/app-data.test.tsx`
- Create: `src/app/[locale]/(app)/settings/currencies/page.tsx`
- Create: `src/components/currencies/currency-sheet.tsx`
- Create: `src/components/currencies/currency-sheet.test.tsx`
- Create: `src/components/currencies/currencies-manager.tsx`
- Create: `src/components/currencies/currencies-manager.test.tsx`
- Modify: `src/app/[locale]/(app)/settings/settings-form.tsx`
- Modify: `src/messages/en.json`
- Modify: `src/messages/ar.json`

**Interfaces:**
- Adds to `AppData`: `currencies`, `enabledCurrencies`, `currencyByCode`, `walletById`, and `balanceById`.
- Produces bilingual currency add/edit/enable/disable/delete UI and structured disable blockers linking to affected wallets/configurations.

- [ ] **Step 1: Write failing provider tests**

Assert stable catalog/balance lookups, enabled filtering, disabled historical lookup, nested wallet identity, and missing-definition failure.

- [ ] **Step 2: Run provider tests and verify RED**

Run: `pnpm vitest run src/components/providers/app-data.test.tsx`

Expected: FAIL because catalog and balances are absent.

- [ ] **Step 3: Load currencies with wallets and expose memoized indexes**

Add `getCurrencies` to the layout `Promise.all`; pass the complete catalog to `AppDataProvider` and derive enabled/index views without mutating inputs.

- [ ] **Step 4: Write failing settings tests**

Assert code/symbol/precision validation, formatted preview, used-field locks, symbol edit, enabled-first order, last-enabled protection, blocker list for non-zero/last-only wallets, cyclic default switch on success, and re-enable not changing defaults.

- [ ] **Step 5: Run settings tests and verify RED**

Run: `pnpm vitest run src/components/currencies`

Expected: FAIL because settings components do not exist.

- [ ] **Step 6: Implement the bilingual currency settings page**

Follow existing sheet/form primitives; keep failed sheets open; isolate codes/amounts with `<bdi dir="ltr">`; render blockers as actionable wallet/configuration links.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `pnpm vitest run src/components/providers/app-data.test.tsx src/components/currencies && pnpm typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add 'src/app/[locale]/(app)/layout.tsx' 'src/app/[locale]/(app)/settings' src/components/providers/app-data.tsx src/components/providers/app-data.test.tsx src/components/currencies src/messages/en.json src/messages/ar.json
git commit -m "feat: add currency settings and runtime catalog"
```

### Task 5: Recommended wallet list and balance management UX

**Files:**
- Rewrite: `src/components/wallets/wallets-view.tsx`
- Rewrite: `src/components/wallets/wallet-sheet.tsx`
- Modify: `src/components/wallets/wallet-select.tsx`
- Create: `src/components/wallets/wallet-balance-sheet.tsx`
- Create: `src/components/wallets/wallet-balance-sheet.test.tsx`
- Create: `src/components/wallets/wallets-view.test.tsx`
- Modify: `src/components/money/amount.tsx`
- Modify: `src/components/home/home-view.tsx`
- Modify: `src/components/shell/composer.tsx`
- Modify: `e2e/currency.spec.ts`

**Interfaces:**
- Consumes Task 3 actions and Task 4 provider.
- Produces the approved **Wallet balances** card: default amount prominent, other balances beneath, no combined total.
- Produces wallet edit actions for rename/kind/add currency/set default/detach and a **Needs attention** legacy section.

- [ ] **Step 1: Write failing wallet-list tests**

Assert one wallet card for three balances, compact one-balance layout, default marker/text, exact runtime formatting, wallet order, deleted exclusion, **Needs attention** visibility, and no combined number.

- [ ] **Step 2: Run wallet-list tests and verify RED**

Run: `pnpm vitest run src/components/wallets/wallets-view.test.tsx`

Expected: FAIL on currency-grouped rendering.

- [ ] **Step 3: Implement the approved wallet-first list**

Make `Amount` resolve the exact runtime definition; permit an explicit definition in isolated tests. Preserve responsive, RTL, and keyboard behavior from existing primitives.

- [ ] **Step 4: Write failing balance-management tests**

Assert first balance becomes default, enabled-only add choices, zero/explicit funding, no implicit funding, default switching, non-zero detach blocker, last-balance blocker, restored balance starts at zero, and disabled balance history remains visible but unavailable.

- [ ] **Step 5: Run balance-management tests and verify RED**

Run: `pnpm vitest run src/components/wallets/wallet-balance-sheet.test.tsx`

Expected: FAIL because management UI does not exist.

- [ ] **Step 6: Implement wallet and balance sheets**

Use wallet container terminology; show all attached balances; reset/revalidate amount text when precision changes; never offer an implicit destination balance creation.

- [ ] **Step 7: Run component and wallet E2E tests**

Run: `pnpm vitest run src/components/wallets src/components/money && pnpm playwright test e2e/currency.spec.ts`

Expected: PASS in English/Arabic cases and without horizontal overflow.

- [ ] **Step 8: Commit**

```bash
git add src/components/wallets src/components/money/amount.tsx src/components/shell/composer.tsx e2e/currency.spec.ts
git commit -m "feat: add multi-currency wallet management"
```

### Task 6: Global wallet ordering

**Files:**
- Create: `src/features/wallets/reorder.ts`
- Create: `src/features/wallets/reorder.test.ts`
- Create: `src/components/wallets/wallet-reorder.tsx`
- Create: `src/components/wallets/wallet-reorder.test.tsx`
- Modify: `src/components/wallets/wallets-view.tsx`
- Modify: `src/features/wallets/actions.ts`
- Modify: `e2e/currency.spec.ts`

**Interfaces:**
- Produces `reorderWallets(ids: string[]): Promise<ActionResult>` backed by Task 2's complete-list RPC.
- Produces accessible pointer and keyboard reordering using existing dnd-kit patterns; every wallet selector consumes the same `position` order.

- [ ] **Step 1: Write failing reorder domain/action tests**

Assert duplicate/missing/foreign IDs reject, exact complete order succeeds, new wallet appends, delete compacts, and errors preserve prior local order.

- [ ] **Step 2: Run reorder tests and verify RED**

Run: `pnpm vitest run src/features/wallets/reorder.test.ts`

Expected: FAIL because wallet reordering does not exist.

- [ ] **Step 3: Implement reorder action/domain helper**

Mirror the category reordering contract but use the owner-scoped wallet lock and active wallet membership.

- [ ] **Step 4: Write failing reorder component tests**

Assert Reorder/Done mode, drag handle labels, ArrowUp/ArrowDown movement, cancel/error recovery, and persisted order reflected in a representative wallet selector.

- [ ] **Step 5: Implement reorder UI**

Use the existing dnd-kit dependency and provide the same reorder operations through labeled keyboard controls.

- [ ] **Step 6: Run reorder unit/component/E2E tests**

Run: `pnpm vitest run src/features/wallets/reorder.test.ts src/components/wallets/wallet-reorder.test.tsx && pnpm playwright test e2e/currency.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/wallets src/components/wallets e2e/currency.spec.ts
git commit -m "feat: add wallet ordering"
```

### Task 7: Exact-balance Move and Exchange flows

**Files:**
- Modify: `src/features/transactions/schema.ts`
- Modify: `src/features/transactions/mutation-input.ts`
- Modify: `src/features/transactions/mutations-core.ts`
- Modify: `src/features/transactions/queries.ts`
- Modify: `src/features/transactions/queries.test.ts`
- Modify: `src/features/transactions/settlement.ts`
- Modify: `src/features/transactions/settlement.test.ts`
- Modify: `src/features/transactions/settlement-serialization.ts`
- Modify: `src/features/transactions/settlement-serialization.test.ts`
- Modify: `src/features/transactions/group.ts`
- Modify: `src/features/transactions/group.test.ts`
- Rewrite: `src/components/add/transaction-sheet.tsx`
- Create: `src/components/add/balance-picker.tsx`
- Create: `src/components/add/balance-picker.test.tsx`
- Modify: `src/components/transactions/transaction-row.tsx`
- Modify: `src/components/transactions/detail-sheet.tsx`
- Modify: `src/components/transactions/activity-view.tsx`
- Modify: `src/messages/en.json`
- Modify: `src/messages/ar.json`
- Modify: `e2e/move.spec.ts`

**Interfaces:**
- Changes every monetary input from guessed wallet currency to exact `balanceId`; transfer input uses `sourceBalanceId`, `destinationBalanceId`, `sentMinor`, and `receivedMinor`.
- Produces `classifyBalanceTransfer(source, destination): "move" | "exchange"`.
- Move: different wallet IDs. Exchange: same wallet ID and different currency codes.

- [ ] **Step 1: Write failing classification and validation tests**

```ts
expect(classifyBalanceTransfer(pocketUsd, bankUsd)).toBe("move");
expect(classifyBalanceTransfer(pocketUsd, bankLbp)).toBe("move");
expect(classifyBalanceTransfer(pocketUsd, pocketLbp)).toBe("exchange");
expect(() => classifyBalanceTransfer(pocketUsd, pocketUsd)).toThrow();
```

Also assert same-currency equality, arbitrary custom cross-currency amounts, USD/LBP-only memo, disabled/detached rejection, and no auto-created destination.

- [ ] **Step 2: Run transaction tests and verify RED**

Run: `pnpm vitest run src/features/transactions src/components/add/balance-picker.test.tsx`

Expected: FAIL on wallet-level currency assumptions.

- [ ] **Step 3: Implement exact-balance schemas, queries, mutations, and picker**

Preselect each wallet's default, show only balances it already has, keep same wallet eligible for a different-currency destination, and reset amount text when precision changes.

- [ ] **Step 4: Update Activity/detail terminology tests**

Assert different-wallet rows say Move, same-wallet cross-currency rows say Exchange, filters distinguish both, and deleted-wallet names remain visible.

- [ ] **Step 5: Implement Activity/detail terminology and run focused tests**

Run: `pnpm vitest run src/features/transactions src/components/add src/components/transactions`

Expected: PASS.

- [ ] **Step 6: Extend and run Move/Exchange E2E**

Cover Pocket USD→Bank USD, Pocket USD→Bank LBP, Pocket USD→Pocket LBP, absent destination currency exclusion, default preselection, custom 8-decimal balance, and both locales.

Run: `pnpm playwright test e2e/move.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/transactions src/components/add src/components/transactions src/messages/en.json src/messages/ar.json e2e/move.spec.ts
git commit -m "feat: add wallet moves and internal exchanges"
```

### Task 8: Guided wallet deletion and durable history

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
- Produces `WalletDeletionPlan { walletId, settlements, blockers }` where each settlement identifies a full positive outgoing or negative incoming same-currency counterpart.
- Produces `inspectWalletDeletion(walletId)` and idempotent `settleAndDeleteWallet(requestId, walletId, settlements)`.
- Deleted wallets remain queryable only for history/export; financial legs touching them become immutable.

- [ ] **Step 1: Write failing deletion-plan tests**

Assert zero wallet immediate eligibility, positive balance outgoing settlement, negative balance incoming settlement, exact full amounts, eligible same-currency counterpart filtering, missing counterpart blocker, active dependency blocker, and deleted-wallet idempotency.

```ts
expect(plan.settlements).toContainEqual({ direction: "out", amountMinor: 500, currency: "USD" });
expect(debtPlan.settlements).toContainEqual({ direction: "in", amountMinor: 300, currency: "USD" });
```

- [ ] **Step 2: Run deletion tests and verify RED**

Run: `pnpm vitest run src/features/wallets/deletion.test.ts src/components/wallets/wallet-delete-sheet.test.tsx`

Expected: FAIL because guided deletion does not exist.

- [ ] **Step 3: Implement deletion inspection/action and guided sheet**

The user chooses one eligible counterpart for each non-zero balance; partial amounts and cross-currency settlement are absent. Submit one request ID and one atomic RPC.

- [ ] **Step 4: Add history immutability and display tests**

Assert Activity/export keep tombstoned wallet name and balance code, monetary edit/delete/restore controls disappear, metadata-only corrections remain, and ordinary wallet selectors exclude it.

- [ ] **Step 5: Implement tombstoned history query and mutation semantics**

Keep snapshots readable, omit active mutation controls, and map database `wallet.deleted` errors if a stale client attempts a monetary change.

- [ ] **Step 6: Run unit/component/E2E deletion verification**

Run: `pnpm vitest run src/features/wallets src/components/wallets src/features/transactions src/features/export && pnpm playwright test e2e/wallet-deletion.spec.ts`

Expected: PASS for positive, negative, zero, blocked, and retry cases.

- [ ] **Step 7: Commit**

```bash
git add src/features/wallets src/components/wallets src/features/transactions/queries.ts src/features/export/model.ts src/messages/en.json src/messages/ar.json e2e/wallet-deletion.spec.ts
git commit -m "feat: add safe wallet deletion"
```

### Task 9: Migrate all remaining money features to balances

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
- Modify: matching tests under every listed feature/component directory

**Interfaces:**
- Consumes exact balance IDs and runtime definitions from Tasks 1-4.
- All new payment/receipt/template actions require attached enabled balances; historical rendering accepts disabled/detached balances.
- Cashier change may target only an existing balance in the selected receiving wallet.

- [ ] **Step 1: Write failing custom/default/disabled tests per feature family**

For budgets, fixed/installments/salary, loans, pending payments, cashier settlement, and breakdowns assert: custom precision renders/parses; wallet default is preselected; another existing balance can be selected; absent currency is not offered; disabled/detached balance cannot create money; historical item remains visible.

- [ ] **Step 2: Run remaining feature tests and verify RED**

Run: `pnpm vitest run src/features/budgets src/features/fixed src/features/installments src/features/salary src/features/loans src/features/pending-payments src/components/budget src/components/fixed src/components/installments src/components/salary src/components/loans src/components/pending-payments src/components/add`

Expected: FAIL on wallet-level currency assumptions.

- [ ] **Step 3: Migrate schemas, actions, queries, summaries, and forms feature by feature**

Keep feature currency snapshots for history, but derive new writes from the selected exact balance. Every selector follows global wallet position and wallet-local default/addition order.

- [ ] **Step 4: Run focused unit/component tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Run feature E2E regression**

Run: `pnpm playwright test e2e/budgets.spec.ts e2e/fixed.spec.ts e2e/installments.spec.ts e2e/salary.spec.ts e2e/loans.spec.ts e2e/pending-payments.spec.ts e2e/cashier.spec.ts e2e/expense-breakdowns.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features src/components e2e
git commit -m "feat: use wallet balances across money features"
```

### Task 10: Dynamic exports and historical integrity

**Files:**
- Modify: `src/features/export/data.ts`
- Modify: `src/features/export/model.ts`
- Modify: `src/features/export/schedules.ts`
- Modify: `src/features/export/schedules.test.ts`
- Modify: `src/features/export/workbook.ts`
- Modify: `src/features/export/workbook.test.ts`
- Modify: `src/app/[locale]/(app)/settings/export/route.ts`

**Interfaces:**
- `ExportData` carries the complete currency catalog, wallet containers, and balance identities.
- `minorToMajor(minor, definition)` uses configured precision.
- Workbook rows expose wallet ID/name, balance ID, currency code, amount, and deleted/detached status separately.

- [ ] **Step 1: Write failing export tests**

Assert 8-decimal scaling, Unicode symbol metadata, disabled currency history, tombstoned wallet name, detached balance ID, no USD fallback, runtime summary rows, and no combined multi-currency wallet total.

- [ ] **Step 2: Run export tests and verify RED**

Run: `pnpm vitest run src/features/export`

Expected: FAIL on fixed currencies and wallet-level amounts.

- [ ] **Step 3: Refactor export loading, schedules, and workbook generation**

Resolve every amount against its exact balance definition; fail `export_data_unavailable` on missing definitions/references; retain numeric spreadsheet values with configured scaling.

- [ ] **Step 4: Run export tests and typecheck**

Run: `pnpm vitest run src/features/export && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/export 'src/app/[locale]/(app)/settings/export/route.ts'
git commit -m "feat: export multi-currency wallet balances"
```

### Task 11: Remove compatibility, document behavior, and verify end to end

**Files:**
- Modify: `src/lib/currency.ts`
- Modify: `src/lib/money.ts`
- Modify: `src/lib/demo-data.ts`
- Modify: `src/app/[locale]/dev/kitchen-sink/kitchen-sink.tsx`
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `DESIGN.md`
- Create: `e2e/currency-settings.spec.ts`
- Modify: `e2e/smoke.spec.ts`
- Modify: every live file returned by the fixed-registry/wallet-currency searches below

**Interfaces:**
- Removes fixed `Currency` unions/maps and all temporary money-helper overloads.
- Removes live assumptions that `wallet.currency` or `wallet.balanceMinor` exists.
- Establishes the final Move/Exchange vocabulary and runtime-only definition path.

- [ ] **Step 1: Add the final English/Arabic lifecycle E2E**

Cover custom BTC creation, Pocket BTC add/default/switch, same-wallet Exchange, cross-wallet Move, destination-missing exclusion, reorder reflected in selectors, currency-disable blockers/default reassignment, positive and negative guided deletion, tombstoned history, and 320px/RTL overflow.

- [ ] **Step 2: Run lifecycle E2E and verify RED**

Run: `pnpm playwright test e2e/currency-settings.spec.ts e2e/wallet-deletion.spec.ts e2e/move.spec.ts`

Expected: FAIL on at least one remaining compatibility path.

- [ ] **Step 3: Remove compatibility APIs and migrate remaining call sites**

Run:

```bash
rg 'CURRENCIES|CURRENCY_DECIMALS|currencyPrefix\(|type Currency\b|wallet\.currency|wallet\.balanceMinor|public\.currency' src supabase --glob '!supabase/migrations/**'
```

Update every live hit to catalog/balance interfaces. The search must return no fixed-registry or wallet-level accounting dependency.

- [ ] **Step 4: Update documentation and kitchen sink**

Document custom currencies, wallet containers/balances, defaults, Move versus Exchange, ordering, deletion, disabling rules, and the USD/LBP-only remembered-rate convenience.

- [ ] **Step 5: Run static and unit verification**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Expected: zero errors and all tests PASS.

- [ ] **Step 6: Run database verification**

Run: `pnpm db:test`, then all gated concurrency scripts against their designated disposable PostgreSQL 17 fixture.

Expected: all pgTAP and concurrency tests PASS without timeouts.

- [ ] **Step 7: Run full E2E and production build**

Run: `pnpm test:e2e && pnpm build`

Expected: all Playwright projects/locales PASS and Next.js builds successfully.

- [ ] **Step 8: Inspect final diff and searches**

Run: `git diff --check`, the Step 3 `rg`, and `git status --short`.

Expected: clean diff formatting, no live fixed-registry assumptions, and only intentional task files changed.

- [ ] **Step 9: Commit**

```bash
git add src supabase e2e README.md PRODUCT.md DESIGN.md
git commit -m "feat: complete custom multi-currency wallets"
```
