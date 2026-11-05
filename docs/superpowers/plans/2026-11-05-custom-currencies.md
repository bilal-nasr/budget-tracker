# Custom Currencies Implementation Plan

> **Superseded:** Do not execute this plan. The approved scope was expanded to multi-currency wallet containers; a replacement plan will follow approval of `docs/superpowers/specs/2026-11-05-custom-currencies-multi-wallets-design.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user create, configure, disable, re-enable, and safely use currencies with custom codes, symbols, and 0-8 decimal places throughout the budget tracker.

**Architecture:** Replace the PostgreSQL currency enum with a tenant-owned `currencies` catalog and text-backed, database-validated references. Load the complete catalog into the app shell, make money helpers consume runtime definitions, and use enabled definitions for creation while retaining all definitions for historical rendering.

**Tech Stack:** Next.js 16.4 App Router, React 19, TypeScript, next-intl, Zod 4, Supabase/PostgreSQL 17 with RLS and pgTAP, Vitest/Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-custom-currencies-design.md`

## Global Constraints

- Before changing Next.js code, read the relevant guide under `node_modules/next/dist/docs/`; for mutations use `01-app/01-getting-started/07-mutating-data.md` and `01-app/02-guides/server-actions.md`.
- Currency codes match `^[A-Z][A-Z0-9]{0,11}$`, are unique per user, and are normalized to uppercase before persistence.
- Symbols are trimmed, non-empty Unicode strings with `char_length <= 12`; render them as text and isolate codes/amounts with bidi-safe markup.
- Symbols containing a Unicode letter or number receive one separator space before the amount; punctuation/symbol-only values are adjacent to the amount.
- Decimal places are integers from 0 through 8 and can never change after first use.
- Keep `MAX_MINOR = 1_000_000_000_000_000`; all scaling and summation use integer/`BigInt` arithmetic.
- At least one currency stays enabled; disabled definitions remain valid for history but cannot create new monetary data.
- Existing USD/LBP/SYP amounts are never rescaled; their migrated definitions are `$`/2, `LBP`/0, and `SYP`/0.
- Do not rewrite historical migrations; add one forward-only migration and regenerate Supabase types.
- Every production change follows red-green-refactor and every task finishes with its focused tests green.

## Review Focus

- A code entered as ` usd ` or `usd` normalizes to `USD` and collides safely with the existing definition; pin this in Task 3 action tests.
- An eight-decimal amount at and just beyond `MAX_MINOR` parses and formats exactly without floating-point loss; pin this in Task 1 money tests.
- A Unicode/bidirectional-looking symbol renders only as text, does not alter code identity, and does not cause horizontal overflow; pin this in Tasks 5 and 9.
- A stored currency code missing from the loaded catalog fails visibly rather than inheriting USD precision; pin this in Task 4 provider/query tests.
- A new monetary write racing with currency disable either commits before disable or observes disabled state and fails without partial data; pin this in Task 2's two-connection test.

---

### Task 1: Runtime currency definitions and precision-aware money helpers

**Files:**
- Modify: `src/lib/currency.ts`
- Modify: `src/lib/currency.test.ts`
- Modify: `src/lib/money.ts`
- Modify: `src/lib/money.test.ts`
- Create: `src/features/currencies/schema.ts`
- Create: `src/features/currencies/schema.test.ts`

**Interfaces:**
- Produces: `CurrencyCode = string` and `CurrencyDefinition = { code: CurrencyCode; symbol: string; decimalPlaces: number; disabled: boolean; firstUsed: boolean }`.
- Produces: `DEFAULT_CURRENCIES: readonly CurrencyDefinition[]`, `currencyCodeSchema`, `currencyInputSchema`, `currencyDefinitionSchema`.
- Produces: `indexCurrencies(definitions): ReadonlyMap<CurrencyCode, CurrencyDefinition>`, `requireCurrency(index, code): CurrencyDefinition`, `enabledCurrencies(definitions): CurrencyDefinition[]`, and `emptyCurrencyTotals(definitions): Record<string, number>`.
- Changes: `parseAmount(input, definition)`, `formatAmount(minor, definition, options)`, and `toInputText(minor, definition)` consume `CurrencyDefinition`; keep temporary overloads for the three defaults until Task 9 removes compatibility.
- Preserves: `supportsUsdLbpRate(fromCode, toCode)` remains code-based and supports only the directed USD/LBP pair.

- [ ] **Step 1: Write failing schema and registry tests**

Add tests for code normalization/validation, symbols of 1 and 12 Unicode code points, rejection of empty/13-code-point symbols, decimal places 0 and 8, rejection of -1/9/fractions, default definition order, runtime map lookup, enabled filtering, missing-definition `RangeError`, and fresh totals for a custom `BTC` definition.

- [ ] **Step 2: Run the registry tests and verify RED**

Run: `pnpm vitest run src/features/currencies/schema.test.ts src/lib/currency.test.ts`

Expected: FAIL because the runtime schemas and helpers do not exist.

- [ ] **Step 3: Implement the currency types, schemas, defaults, and registry helpers**

Implement the exact interfaces above. `currencyInputSchema` returns normalized `{ code, symbol, decimalPlaces }`; definitions derive `disabled` and `firstUsed` from persistence rather than accepting those flags from add/edit form input.

- [ ] **Step 4: Run the registry tests and verify GREEN**

Run: `pnpm vitest run src/features/currencies/schema.test.ts src/lib/currency.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing precision-aware money tests**

Add assertions for 0-, 2-, 3-, and 8-decimal definitions; Arabic-Indic input; exact `0.00000001`; exact formatting at `MAX_MINOR`; rejection just beyond `MAX_MINOR`; too many fractional digits; adjacent punctuation-only symbols (`$1.00`, `₿0.00000001`); spaced letter-containing symbols (`LBP 1,000`); and no fallback when a definition is absent.

- [ ] **Step 6: Run the money tests and verify RED**

Run: `pnpm vitest run src/lib/money.test.ts`

Expected: FAIL because helpers still read global precision and prefix maps.

- [ ] **Step 7: Implement definition-driven money parsing and formatting**

Use `BigInt(10) ** BigInt(definition.decimalPlaces)` for scaling. Keep the current digit localization and sign behavior, render exactly the configured fractional digits, and let editable text trim insignificant trailing zeroes.

- [ ] **Step 8: Run focused and full unit tests**

Run: `pnpm vitest run src/features/currencies/schema.test.ts src/lib/currency.test.ts src/lib/money.test.ts && pnpm test`

Expected: all tests PASS with compatibility overloads keeping existing callers green.

- [ ] **Step 9: Commit**

```bash
git add src/lib/currency.ts src/lib/currency.test.ts src/lib/money.ts src/lib/money.test.ts src/features/currencies/schema.ts src/features/currencies/schema.test.ts
git commit -m "feat: add runtime currency definitions"
```

### Task 2: Tenant currency catalog and enum-to-text database migration

**Files:**
- Create: `supabase/migrations/20261123000000_user_currencies.sql`
- Create: `supabase/tests/user_currencies.test.sql`
- Create: `supabase/tests/user-currency-concurrency.mjs`
- Modify: `supabase/tests/currency.test.sql`
- Create: `src/lib/supabase/database.types.ts`

**Interfaces:**
- Produces: `public.currencies(user_id, code, symbol, decimal_places, first_used_at, disabled_at, created_at)` with primary key `(user_id, code)` and owner-only RLS.
- Produces RPCs: `create_currency(p_code text, p_symbol text, p_decimal_places smallint)`, `update_currency(p_code text, p_next_code text, p_symbol text, p_decimal_places smallint)`, `set_currency_enabled(p_code text, p_enabled boolean)`, and `delete_currency(p_code text)`.
- Produces stable database errors: `currency.invalid`, `currency.duplicate`, `currency.inUse`, `currency.lastEnabled`, and `currency.disabled`.
- Changes all database currency columns and function signatures from `public.currency` to validated `text` while preserving stored values.

- [ ] **Step 1: Write the failing pgTAP catalog and migration tests**

Cover default bootstrapping for new and existing users; exact migrated USD/LBP/SYP metadata and unchanged minor amounts; constraints; RLS isolation; normalized duplicate rejection; last-enabled protection; used-definition code/precision locking through `first_used_at`; symbol edits after use; unused deletion; referenced deletion rejection; enable/disable; and all currency-bearing tables/RPC return types using text.

- [ ] **Step 2: Run pgTAP and verify RED**

Run: `pnpm db:test`

Expected: FAIL because `public.currencies` and the new RPCs do not exist.

- [ ] **Step 3: Implement the forward-only migration**

Create/backfill definitions first; replace dependent views/functions, JSON enum casts, columns, and RPC signatures in dependency-safe order; add composite references or locked trigger validation; update `bootstrap_user`; then drop `public.currency`. Preserve the legacy USD/LBP memo only for enabled USD/LBP codes.

- [ ] **Step 4: Run pgTAP and verify GREEN**

Run: `pnpm db:test`

Expected: all database tests PASS, including existing currency, transfer, cashier, budget, installment, loan, and pending-payment suites.

- [ ] **Step 5: Write the failing two-connection race tests**

Add deterministic lock-barrier cases for first-use versus code/precision edit, first-use versus delete, new wallet/transaction versus disable, and re-enable versus creation. Assert one serial order wins, no orphan/partial row exists, and `first_used_at` is durable after reference deletion.

- [ ] **Step 6: Run concurrency tests and verify RED**

Run the new script with the same explicit disposable PG17 environment gates used by `supabase/tests/currency-references-concurrency.mjs`.

Expected: FAIL until currency-definition row locking is complete.

- [ ] **Step 7: Add row-locking and enabled-state enforcement to every monetary creation path**

Centralize the database lookup/lock in private SQL helpers used by wallet creation and all RPCs/triggers. Existing-row edits that preserve currency remain allowed; new transaction/payment/template/root creation requires enabled state.

- [ ] **Step 8: Run database and concurrency suites**

Run: `pnpm db:test`, then the existing and new gated concurrency scripts against the disposable PG17 fixture.

Expected: all PASS with no lock timeout or partial data.

- [ ] **Step 9: Regenerate database types and typecheck them**

Run: `pnpm db:types && pnpm typecheck`

Expected: generated `currencies` rows/RPCs use `string` codes and TypeScript reports no errors caused by stale enum types.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20261123000000_user_currencies.sql supabase/tests/user_currencies.test.sql supabase/tests/user-currency-concurrency.mjs supabase/tests/currency.test.sql src/lib/supabase/database.types.ts
git commit -m "feat: add tenant currency catalog"
```

### Task 3: Currency queries and authenticated mutation actions

**Files:**
- Create: `src/features/currencies/queries.ts`
- Create: `src/features/currencies/queries.test.ts`
- Create: `src/features/currencies/actions.ts`
- Create: `src/features/currencies/actions.test.ts`
- Modify: `src/lib/demo-data.ts`
- Modify: `src/lib/supabase/action.ts`

**Interfaces:**
- Consumes: Task 1 schemas/types and Task 2 RPCs.
- Produces: cached `getCurrencies(): Promise<CurrencyDefinition[]>` ordered by `created_at, code`, returning `DEFAULT_CURRENCIES` only when Supabase is unconfigured.
- Produces: `createCurrency(input)`, `updateCurrency(currentCode, input)`, `setCurrencyEnabled(code, enabled)`, and `deleteCurrency(code)` returning `ActionResult` after extending `ActionError` with `duplicateCurrency`, `lastEnabledCurrency`, `currencyInUse`, and `currencyDisabled`.

- [ ] **Step 1: Write failing query tests**

Test row mapping for enabled/disabled/used state, deterministic order, unconfigured defaults, malformed rows failing visibly, and database errors producing `Currency data unavailable` rather than defaults.

- [ ] **Step 2: Run query tests and verify RED**

Run: `pnpm vitest run src/features/currencies/queries.test.ts`

Expected: FAIL because `getCurrencies` does not exist.

- [ ] **Step 3: Implement `getCurrencies` and demo data**

Map `decimal_places`, `first_used_at`, and `disabled_at` through `currencyDefinitionSchema`; log database errors consistently with other feature queries.

- [ ] **Step 4: Run query tests and verify GREEN**

Run: `pnpm vitest run src/features/currencies/queries.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing action tests**

Test unauthenticated/unconfigured behavior, invalid code/symbol/precision, ` usd ` normalization and collision mapping, each stable RPC error, success revalidating `"/", "layout"`, and an unexpected error returning `failed`.

- [ ] **Step 6: Run action tests and verify RED**

Run: `pnpm vitest run src/features/currencies/actions.test.ts`

Expected: FAIL because actions do not exist.

- [ ] **Step 7: Implement authenticated currency actions**

Validate before calling `actionClient`, invoke only Task 2 RPCs, map only known database messages, and revalidate the root layout on success.

- [ ] **Step 8: Run focused tests and typecheck**

Run: `pnpm vitest run src/features/currencies/queries.test.ts src/features/currencies/actions.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/currencies src/lib/demo-data.ts src/lib/supabase/action.ts
git commit -m "feat: add currency data access"
```

### Task 4: Load and expose the complete runtime catalog

**Files:**
- Modify: `src/app/[locale]/(app)/layout.tsx`
- Modify: `src/components/providers/app-data.tsx`
- Create: `src/components/providers/app-data.test.tsx`
- Modify: `src/features/wallets/queries.ts`
- Modify: `src/features/wallets/queries.test.ts`
- Modify: `src/features/transactions/queries.ts`
- Modify: `src/features/transactions/queries.test.ts`

**Interfaces:**
- Consumes: `getCurrencies()` and Task 1 registry helpers.
- Produces through `AppData`: `currencies`, `enabledCurrencies`, and `currencyByCode(code): CurrencyDefinition | undefined` alongside wallets/categories/profile data.
- Changes query mappers to accept/use a definition index and throw an unavailable-state error for unknown stored codes.

- [ ] **Step 1: Write failing provider tests**

Assert complete and enabled lists, stable lookup identity, disabled definitions remaining addressable, and no mutation of input arrays.

- [ ] **Step 2: Run provider tests and verify RED**

Run: `pnpm vitest run src/components/providers/app-data.test.tsx`

Expected: FAIL because catalog fields are absent.

- [ ] **Step 3: Add `getCurrencies` to the app layout and provider**

Fetch the catalog in the existing `Promise.all`, build one memoized index, and pass complete definitions to all descendants.

- [ ] **Step 4: Run provider tests and verify GREEN**

Run: `pnpm vitest run src/components/providers/app-data.test.tsx`

Expected: PASS.

- [ ] **Step 5: Write failing unknown-code query tests**

Add wallet and transaction fixtures with `currency: "MISSING"`; assert each query rejects visibly instead of formatting or parsing with USD. Add a valid custom-code fixture to prove runtime acceptance.

- [ ] **Step 6: Run query tests and verify RED**

Run: `pnpm vitest run src/features/wallets/queries.test.ts src/features/transactions/queries.test.ts`

Expected: FAIL because queries still use the compile-time registry.

- [ ] **Step 7: Validate query currencies against the request catalog**

Share the cached `getCurrencies` result; accept valid custom codes and reject missing definitions for root and nested settlement/change currencies.

- [ ] **Step 8: Run focused tests and typecheck**

Run: `pnpm vitest run src/components/providers/app-data.test.tsx src/features/wallets/queries.test.ts src/features/transactions/queries.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add 'src/app/[locale]/(app)/layout.tsx' src/components/providers/app-data.tsx src/components/providers/app-data.test.tsx src/features/wallets/queries.ts src/features/wallets/queries.test.ts src/features/transactions/queries.ts src/features/transactions/queries.test.ts
git commit -m "feat: provide runtime currencies to the app"
```

### Task 5: Currency settings page and management sheets

**Files:**
- Create: `src/app/[locale]/(app)/settings/currencies/page.tsx`
- Create: `src/components/currencies/currencies-manager.tsx`
- Create: `src/components/currencies/currencies-manager.test.tsx`
- Create: `src/components/currencies/currency-sheet.tsx`
- Create: `src/components/currencies/currency-sheet.test.tsx`
- Modify: `src/app/[locale]/(app)/settings/settings-form.tsx`
- Modify: `src/messages/en.json`
- Modify: `src/messages/ar.json`
- Create: `e2e/currency-settings.spec.ts`

**Interfaces:**
- Consumes: Task 3 actions/queries and Task 4 provider definitions.
- Produces: bilingual `/[locale]/settings/currencies`, an enabled-then-disabled list, and add/edit sheets with a formatted preview.

- [ ] **Step 1: Write failing add/edit sheet component tests**

Assert code uppercasing, code/symbol/0-8 validation, representative preview, add submission, unlocked edit submission, code/precision read-only after `firstUsed`, symbol still editable after use, inline stable errors, and a Unicode/bidi-looking symbol rendered as literal text rather than markup.

- [ ] **Step 2: Run sheet tests and verify RED**

Run: `pnpm vitest run src/components/currencies/currency-sheet.test.tsx`

Expected: FAIL because the sheet does not exist.

- [ ] **Step 3: Implement `CurrencySheet`**

Use existing `SheetShell`, `TextField`, `Button`, and form patterns. The decimal field uses numeric input constrained to 0-8; the preview calls Task 1 formatting with the draft definition.

- [ ] **Step 4: Run sheet tests and verify GREEN**

Run: `pnpm vitest run src/components/currencies/currency-sheet.test.tsx`

Expected: PASS.

- [ ] **Step 5: Write failing manager tests**

Assert enabled-first ordering, disabled badge/status, add/edit sheet opening, disable confirmation, last-enabled action hidden/disabled, enable action, unused delete confirmation, used delete absence, and state refresh after successful actions.

- [ ] **Step 6: Run manager tests and verify RED**

Run: `pnpm vitest run src/components/currencies/currencies-manager.test.tsx`

Expected: FAIL because the manager and page do not exist.

- [ ] **Step 7: Implement the settings route, manager, link, and bilingual messages**

Follow the categories settings route's server-page shape and existing visual primitives. Codes and examples use `<bdi dir="ltr">`; failures use `role="alert"` and keep the sheet open.

- [ ] **Step 8: Run component tests and the initial settings E2E**

Add Playwright coverage for navigation, validation, add/edit/disable/enable/delete controls in both locales. Run: `pnpm vitest run src/components/currencies && pnpm playwright test e2e/currency-settings.spec.ts`.

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add 'src/app/[locale]/(app)/settings/currencies' 'src/app/[locale]/(app)/settings/settings-form.tsx' src/components/currencies src/messages/en.json src/messages/ar.json e2e/currency-settings.spec.ts
git commit -m "feat: add currency settings"
```

### Task 6: Dynamic wallets, totals, home, and budgets

**Files:**
- Modify: `src/features/wallets/schema.ts`
- Modify: `src/features/wallets/schema.test.ts`
- Modify: `src/features/wallets/totals.ts`
- Modify: `src/features/wallets/actions.ts`
- Modify: `src/components/wallets/wallet-sheet.tsx`
- Modify: `src/components/wallets/wallets-view.tsx`
- Modify: `src/components/home/home-view.tsx`
- Modify: `src/components/money/amount.tsx`
- Modify: `src/features/budgets/schema.ts`
- Modify: `src/features/budgets/queries.ts`
- Modify: `src/features/budgets/rows.ts`
- Modify: `src/components/budget/budgets-sheet.tsx`
- Modify: `src/components/budget/budgets-view.tsx`
- Modify: `src/app/[locale]/(app)/budgets/page.tsx`
- Modify: `e2e/currency.spec.ts`
- Modify: `e2e/budgets.spec.ts`

**Interfaces:**
- Consumes: provider `enabledCurrencies` for creation and `currencyByCode` for rendering; Task 1 definition-aware money helpers.
- Produces: runtime-keyed wallet/budget totals and enabled-only wallet/budget currency controls.
- Changes: `Amount` keeps its `currency: string` public prop, resolves the definition from `AppData`, and accepts an explicit `definition: CurrencyDefinition` only for isolated rendering/tests outside the provider.

- [ ] **Step 1: Write failing wallet/custom-total tests**

Add a `BTC` eight-decimal wallet fixture and disabled historical fixture. Assert runtime totals contain only supplied definitions, Amount renders the custom symbol/precision, wallet creation lists enabled currencies only, and an existing disabled wallet still renders.

- [ ] **Step 2: Run wallet tests and verify RED**

Run: `pnpm vitest run src/features/wallets/schema.test.ts src/components/wallets`

Expected: FAIL on fixed records/selectors.

- [ ] **Step 3: Refactor wallets, totals, Amount, and home rendering**

Make schemas validate the code shape while the action/database validates ownership/enabled state. Replace fixed object iteration with catalog/result-driven maps. All amount rendering resolves the exact definition and throws into existing unavailable boundaries if absent.

- [ ] **Step 4: Run wallet tests and verify GREEN**

Run: `pnpm vitest run src/features/wallets/schema.test.ts src/components/wallets src/components/money`

Expected: PASS.

- [ ] **Step 5: Write failing budget tests**

Assert custom enabled query selection, invalid/repeated query fallback to the first enabled definition, disabled historical result rendering, enabled-only new budget controls, and separate totals for custom codes.

- [ ] **Step 6: Run budget tests and verify RED**

Run: `pnpm vitest run src/features/budgets src/components/budget`

Expected: FAIL because budget code iterates fixed currencies.

- [ ] **Step 7: Refactor budget query validation, rows, forms, and views**

Use the runtime catalog for URL parsing and form choices. Preserve disabled codes only when backed by returned historical data; never merge totals across codes.

- [ ] **Step 8: Run focused unit and E2E tests**

Run: `pnpm vitest run src/features/wallets src/features/budgets src/components/wallets src/components/budget src/components/money && pnpm playwright test e2e/currency.spec.ts e2e/budgets.spec.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/wallets src/components/wallets src/components/home src/components/money src/features/budgets src/components/budget 'src/app/[locale]/(app)/budgets/page.tsx' e2e/currency.spec.ts e2e/budgets.spec.ts
git commit -m "feat: use custom currencies in wallets and budgets"
```

### Task 7: Dynamic transactions, transfers, cashier settlement, and activity

**Files:**
- Modify: `src/features/transactions/schema.ts`
- Modify: `src/features/transactions/mutation-input.ts`
- Modify: `src/features/transactions/mutations-core.ts`
- Modify: `src/features/transactions/settlement.ts`
- Modify: `src/features/transactions/settlement.test.ts`
- Modify: `src/features/transactions/settlement-serialization.ts`
- Modify: `src/features/transactions/settlement-serialization.test.ts`
- Modify: `src/features/transactions/group.ts`
- Modify: `src/features/transactions/group.test.ts`
- Modify: `src/components/add/transaction-sheet.tsx`
- Modify: `src/components/add/amount-keypad.tsx`
- Modify: `src/components/add/cash-settlement-fields.tsx`
- Modify: `src/components/add/cash-settlement-fields.test.tsx`
- Modify: `src/components/add/expense-breakdown-fields.tsx`
- Modify: `src/components/transactions/activity-view.tsx`
- Modify: `src/components/transactions/transaction-row.tsx`
- Modify: `src/components/transactions/detail-sheet.tsx`
- Modify: `src/components/transactions/cash-settlement-summary.tsx`
- Modify: `src/components/transactions/cash-settlement-summary.test.tsx`
- Modify: `e2e/move.spec.ts`
- Modify: `e2e/cashier.spec.ts`
- Modify: `e2e/expense-breakdowns.spec.ts`

**Interfaces:**
- Consumes: runtime definitions for every cost, tender, change, source, and destination code.
- Produces: enabled-only new-entry wallet/currency options; exact explicit transfers for arbitrary code pairs; result-driven historical grouping.

- [ ] **Step 1: Write failing transaction/settlement tests**

Add arbitrary pairs (`BTC→EUR`, `EUR→BTC`), same-code equality, eight-decimal tender/change, disabled-wallet exclusion from creation, disabled historical settlement rendering, unknown nested change-code rejection, and USD/LBP as the only remembered-rate pair.

- [ ] **Step 2: Run transaction tests and verify RED**

Run: `pnpm vitest run src/features/transactions src/components/add src/components/transactions`

Expected: FAIL on fixed currency validation/formatting.

- [ ] **Step 3: Refactor transaction schemas, serialization, validation, and grouping**

Validate code syntax in Zod, definition existence in query/application context, and enabled state in the database. Runtime totals use maps. Settlement logic compares code identity and explicit integer amounts; only USD/LBP uses the legacy rate memo.

- [ ] **Step 4: Refactor add/activity/detail components**

Resolve definitions from the provider for parsing and rendering, filter disabled currencies/wallets from all new-entry choices, and retain disabled definitions for historical sheets and summaries.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm vitest run src/features/transactions src/components/add src/components/transactions`

Expected: PASS.

- [ ] **Step 6: Extend and run transaction E2E coverage**

Test a custom eight-decimal expense and explicit custom cross-currency transfer, then disable one definition and verify history remains while new entry excludes it. Run: `pnpm playwright test e2e/move.spec.ts e2e/cashier.spec.ts e2e/expense-breakdowns.spec.ts e2e/currency-settings.spec.ts`.

Expected: PASS in English and Arabic cases already parameterized by the suites.

- [ ] **Step 7: Commit**

```bash
git add src/features/transactions src/components/add src/components/transactions e2e/move.spec.ts e2e/cashier.spec.ts e2e/expense-breakdowns.spec.ts e2e/currency-settings.spec.ts
git commit -m "feat: use custom currencies in transactions"
```

### Task 8: Dynamic currencies in recurring, debt, receivable, and export features

**Files:**
- Modify: `src/features/fixed/summary.ts`
- Modify: `src/features/fixed/summary.test.ts`
- Modify: `src/components/fixed/fixed-card.tsx`
- Modify: `src/components/fixed/fixed-sheet.tsx`
- Modify: `src/features/installments/schema.ts`
- Modify: `src/features/installments/cycle.ts`
- Modify: `src/features/installments/cycle-queries.ts`
- Modify: `src/components/installments/installment-sheet.tsx`
- Modify: `src/components/installments/installment-pay-sheet.tsx`
- Modify: `src/features/salary/schema.ts`
- Modify: `src/components/salary/salary-card.tsx`
- Modify: `src/components/salary/salary-sheet.tsx`
- Modify: `src/features/loans/schema.ts`
- Modify: `src/features/loans/queries.ts`
- Modify: `src/features/loans/calculations.ts`
- Modify: `src/components/loans/loan-sheet.tsx`
- Modify: `src/components/loans/loan-payment-sheet.tsx`
- Modify: `src/components/loans/loans-view.tsx`
- Modify: `src/features/pending-payments/schema.ts`
- Modify: `src/features/pending-payments/queries.ts`
- Modify: `src/components/pending-payments/payment-sheet.tsx`
- Modify: `src/components/pending-payments/receipt-sheet.tsx`
- Modify: `src/components/pending-payments/pending-payments-view.tsx`
- Modify: `src/features/export/data.ts`
- Modify: `src/features/export/model.ts`
- Modify: `src/features/export/schedules.ts`
- Modify: `src/features/export/schedules.test.ts`
- Modify: `src/features/export/workbook.ts`
- Modify: `src/features/export/workbook.test.ts`
- Modify: `e2e/fixed.spec.ts`
- Modify: `e2e/installments.spec.ts`
- Modify: `e2e/salary.spec.ts`
- Modify: `e2e/loans.spec.ts`
- Modify: `e2e/pending-payments.spec.ts`

**Interfaces:**
- Consumes: complete definitions for rendering and enabled definitions/wallets for new payment actions.
- Produces: runtime-code summaries and exports; paused actions for existing templates/items whose currency is disabled. `ExportData` carries the complete `currencies: CurrencyDefinition[]` catalog, and `minorToMajor(minor, definition)` performs configured scaling.

- [ ] **Step 1: Write failing feature tests for custom and disabled definitions**

For each feature family, add one custom precision render/parse case and one disabled case: existing item remains visible, but create/pay/receive action is unavailable until re-enabled. Loan and fixed/installment totals must remain separated by runtime code.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run src/features/fixed src/features/installments src/features/salary src/features/loans src/features/pending-payments src/components/fixed src/components/installments src/components/salary src/components/loans src/components/pending-payments`

Expected: FAIL where fixed currency maps or global precision remain.

- [ ] **Step 3: Refactor feature schemas, queries, summaries, forms, and cards**

Use code-shape schemas plus definition lookup, runtime maps for summaries, and provider definitions for money helpers. Preserve existing records and disable only actions that would create monetary rows.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same Vitest command.

Expected: PASS.

- [ ] **Step 5: Write failing export tests**

Add a custom eight-decimal row and Unicode symbol; assert exported numeric values remain numeric minor-derived major values with exact configured scaling, code columns retain identity, disabled history is included, and unknown codes fail export visibly.

- [ ] **Step 6: Run export tests and verify RED**

Run: `pnpm vitest run src/features/export`

Expected: FAIL because export uses the fixed registry.

- [ ] **Step 7: Pass the catalog through export data/model/workbook generation**

Resolve every amount with its definition, include disabled historical data, and keep codes separate from symbols in machine-readable columns.

- [ ] **Step 8: Run unit and feature E2E tests**

Run: `pnpm vitest run src/features/export src/features/fixed src/features/installments src/features/salary src/features/loans src/features/pending-payments && pnpm playwright test e2e/fixed.spec.ts e2e/installments.spec.ts e2e/salary.spec.ts e2e/loans.spec.ts e2e/pending-payments.spec.ts`.

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/fixed src/components/fixed src/features/installments src/components/installments src/features/salary src/components/salary src/features/loans src/components/loans src/features/pending-payments src/components/pending-payments src/features/export e2e/fixed.spec.ts e2e/installments.spec.ts e2e/salary.spec.ts e2e/loans.spec.ts e2e/pending-payments.spec.ts
git commit -m "feat: use custom currencies across money features"
```

### Task 9: Remove fixed-registry compatibility and complete regression verification

**Files:**
- Modify: `src/lib/currency.ts`
- Modify: `src/lib/money.ts`
- Modify: `src/lib/demo-data.ts`
- Modify: `src/app/[locale]/dev/kitchen-sink/kitchen-sink.tsx`
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `DESIGN.md`
- Modify: `e2e/currency-settings.spec.ts`
- Modify: all remaining files returned by `rg 'CURRENCIES|CURRENCY_DECIMALS|currencyPrefix\(|type Currency\b|public\.currency' src supabase --glob '!supabase/migrations/20261123000000_user_currencies.sql'`

**Interfaces:**
- Removes: fixed global currency union/maps and temporary string overloads from Task 1.
- Establishes: every amount parser/formatter receives a real `CurrencyDefinition`; every iteration comes from a catalog or actual result set.

- [ ] **Step 1: Add the final end-to-end lifecycle test**

In both locales: create `BTC` with `₿` and 8 decimals; create/use a wallet; verify `₿0.00000001` in history; disable BTC; verify history remains and BTC disappears from every sampled new-entry control; verify existing template payment is unavailable; re-enable; verify creation resumes. Add mobile-width no-horizontal-overflow assertions with a 12-character Unicode symbol.

- [ ] **Step 2: Run the lifecycle E2E and verify RED**

Run: `pnpm playwright test e2e/currency-settings.spec.ts`

Expected: FAIL on at least one remaining compatibility path.

- [ ] **Step 3: Remove compatibility APIs and migrate remaining call sites**

Run the `rg` command from **Files**, update every live source/test reference, and leave historical migration files unchanged. The kitchen sink receives the default catalog through local fixtures.

- [ ] **Step 4: Update product documentation**

Replace claims that wallets are limited to USD/LBP/SYP with custom-currency behavior, 0-8 precision, disabling semantics, and the USD/LBP-only remembered reference-rate exception.

- [ ] **Step 5: Run static and unit verification**

Run: `pnpm lint && pnpm typecheck && pnpm test`

Expected: zero errors and all unit/component tests PASS.

- [ ] **Step 6: Run database verification**

Run: `pnpm db:test`, then both currency concurrency scripts using their explicit disposable PG17 gates.

Expected: all pgTAP and concurrency tests PASS.

- [ ] **Step 7: Run full end-to-end verification**

Run: `pnpm test:e2e`

Expected: all Playwright tests PASS in configured projects/locales, including overflow checks.

- [ ] **Step 8: Build the production app**

Run: `pnpm build`

Expected: successful Next.js production build with no type, route, or prerender errors.

- [ ] **Step 9: Inspect the final diff and fixed-registry search**

Run: `git diff --check && rg 'CURRENCIES|CURRENCY_DECIMALS|currencyPrefix\(|type Currency\b|public\.currency' src supabase --glob '!supabase/migrations/**'`.

Expected: `git diff --check` is clean and the registry search returns no live fixed-registry dependency.

- [ ] **Step 10: Commit**

```bash
git add src supabase README.md PRODUCT.md DESIGN.md e2e
git commit -m "feat: complete custom currency support"
```
