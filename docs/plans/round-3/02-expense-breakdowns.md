# Optional Expense Breakdowns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task, or the orchestrator's explicitly chosen execution workflow. Steps use checkbox (`- [ ]`) syntax for tracking. Do not stage, commit, push, or create additional chats/worktrees without authorization.

**Goal:** Let a person optionally describe what one expense comprises while preserving its name/payee, its total, and exactly one financial event.

**Architecture:** Keep `transactions` as the ledger and store one level of descriptive items in a separate `expense_items` table. Save the parent and complete item list through the canonical authenticated, atomic `save_transaction(p_id,p_expected_revision,p_input,p_items)` RPC, with a stable client-generated parent UUID for create retries and one shared integer revision. Delete/restore use `set_transaction_deleted`; item 4 extends these same contracts with settlement rather than adding a competing save API. Existing balance and spending readers continue to aggregate parent transactions only.

**Tech Stack:** Existing Next.js 16.4.5 App Router, React 19.3, Supabase/Postgres with RLS, TypeScript, zod 4, next-intl, existing SheetShell/TextField/Amount primitives, Vitest, pgTAP, Playwright. No new dependency is proposed.

**Spec:** The proposed design in this file implements owner item 2 from the round-3 planning delegation. Read it with `AGENTS.md`, `CLAUDE.md`, `PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/MOBILE-UX.md`, `DESIGN.md`, and `.impeccable/surfaces/src-app-locale.md`. Everything described as a recommendation below is a proposal, not an owner-approved decision.

## Execution ledger — Phase A

The owner subsequently approved implementation and the orchestrator leased only the new domain/components/migration/tests for this phase. This later authorization supersedes the planning-only constraint below; shared schema/actions/queries/composer/messages/demo and root docs remain outside this phase's write lease. Final staging/commit/push belongs to the parent orchestrator.

- [x] Implement/export `ExpenseItemInput`, `ExpenseItem`, `ExpenseItemDraft`, strict `expenseItemInputSchema`, `summarizeBreakdown`, and `parseExpenseItemDrafts` in `src/features/transactions/breakdown.ts`.
- [x] Watch missing-module tests fail, implement helpers/components, and pass targeted domain/component tests. Added a persisted-read-model regression that failed before fixing summary validation: read-only IDs/positions are allowed in summary inputs, while mutation item schema stays strict.
- [x] Implement isolated `src/components/add/expense-breakdown-fields.tsx` and read-only `src/components/transactions/expense-breakdown.tsx`, with translated labels supplied through props pending shared-message integration. Stable keys, add/remove focus, collapsed draft retention, native money inputs, limits, exact summaries, `Amount`/bdi and logical utilities are covered by component tests.
- [x] Author reserved append-only `20261111000300_expense_breakdowns.sql`: separate RLS item rows, composite ownership FK, one revision trigger, deferred direct-write sum/kind guards, saved-item currency guard, stable-ID canonical four-argument save and exact-revision lifecycle RPC. Existing category/SYP/source integrity functions are not replaced.
- [x] Author rollback-only `supabase/tests/expense_breakdowns.test.sql` and local-only opt-in `expense-breakdowns-concurrency.mjs` (same-UUID overlapping creates, stale concurrent edits, direct remainder insertion race). The harness refuses non-loopback URLs and never starts/resets a database or loads an env file.
- [x] Run targeted Vitest: **26/26 passed**. Run file-scoped ESLint: **passed**. Run in-memory TypeScript analysis rooted only at the five leased TS/TSX files with no emit/incremental cache: **passed**. `node --check` concurrency script: **passed**. Impeccable mechanical detector: **[]** (no findings).
- [ ] Execute pgTAP migration tests and multi-session harness on the parent-coordinated disposable SQL stack. No Docker containers were running when checked; no SQL migration, stack start or reset was attempted. SQL behavior is authored/reviewed, not runtime-verified yet.
- [ ] Integrate shared transaction schema/actions/queries, revisions in all Undo callbacks, translated messages, demo fixtures and existing composer/detail sheets after the orchestrator releases the next phase. Then run browser/mobile screenshots and final combined checks; isolated component tests do not establish physical-phone behavior.

Ruling: keep the execution ledger in this already-owned plan rather than create a skill workspace outside the write lease. Ruling: component labels are required injected props until shared messages are released; no untranslated production strings or global-message edits were added. Ruling: use the reserved `expense-breakdown-fields.tsx` filename, not the earlier editor name. Phase A introduces no dependency or global config change, runs no global build/typecheck/lint/E2E, and makes no commit.

### Follow-up isolated mutation-core lease

- [x] Fix the two pgTAP modifying CTE assertions to be top-level after the parent's PG18 run exposed invalid nesting. Preserve baseline null-UUID expectation; the parent coordinated later wrapper validation separately. Subsequently read `.impeccable/build/pg17-expense_breakdowns.test.sql.log`: the parent's PG17 replay shows **45/45 breakdown assertions passing**. This is parent-run SQL evidence, not a claim that this session applied migrations.
- [x] Add `src/features/transactions/mutation-input.ts`: reusable canonical zod schema/type, stable lowercase UUID and exact integer revision validation, strict item/settlement rules, and the sole `transactionSaveArgs` payload mapper. Existing schema will reexport these in the later integration phase; no duplicate parent/items/settlement mapping is needed.
- [x] Add server-only `src/features/transactions/mutations-core.ts`: create/update/delete/restore cores authenticate via `actionClient`, make exactly one canonical RPC, validate one matching `{id,revision}` result, map finite database errors, revalidate only successful results, and never generate IDs, fetch/adopt revisions, or perform unchecked mutation fallbacks. Existing Server Action exports are deliberately not wired yet.
- [x] Watch the missing core test module fail, implement, and run `mutations-core.test.ts`: **31/31 pass**. An additional RED→GREEN case rejects responses with a revision older than the supplied token (save must advance it; same-state lifecycle may return it unchanged). Combined leased helper/component/core selection: **57/57 pass**. Scoped ESLint and in-memory TypeScript analysis of new core roots pass; no global build/typecheck/lint/E2E run.
- [x] Extend `expense-breakdowns-concurrency.mjs` with exact Docker pairs only: `supabase_db_budget-tracker-round3-check` / `round3_check_17` and `budget_round3_sql_probe` / `round3_check_2`. No host psql, service config or password file is needed in Docker mode. A guard check confirms a mismatched database is rejected before SQL.
- [x] Run the harness on the parent's designated **PG17 / round3_check_17** database: identical overlapping creates return one ID/final revision with one debit; stale overlapping update fails; direct concurrent item writers cannot both consume the remaining amount. All races pass and synthetic account/fixtures are removed in `finally`. No server startup/reset, migration change or hosted write occurred.
- [ ] Release/wire the existing schema/actions/queries/composer/messages only after the currency/shared-file phase ends. Thin public actions must delegate to this core without repeating validation/payload mapping/revalidation; follow the required draft UUID and expected-revision signatures.

Ruling: unset `PGSERVICE`/`PGSERVICEFILE` in the test harness rather than set empty values: the first designated Docker run showed libpq still tries to load a service file for an empty service. After the fix, PG17 races passed. This change affects only opt-in local testing and does not read application secrets or change runtime configuration.

### Shared integration lease — complete, released for cashier integration

- [x] Reexport the canonical input schema/type and item types from `transactions/schema.ts`; wire existing manual create/update/delete/restore Server Actions directly to the tested core. All lifecycle calls require captured revisions. Read models now include revision, ordered items and read-only source/fixed/installment/loan identifiers; these are not writable input fields.
- [x] Extend the parent-only keyset projection with the composite-FK nested item relation. Add query tests proving no multiplied rows/cursor changes and retained provenance. Installment history live reads now carry `InstallmentPayment.transaction` with the actual full parent snapshot; later cycle-query integration must preserve it rather than fabricate revision 1 or the template name.
- [x] Wire composer-generated stable draft UUIDs, optional item editing, computed remainder/excess, saved-currency guards, source-kind guard, duplicate item copying, exact-token edits, and guarded detail/create/source Undo. Unknown create outcomes freeze inputs and retry the original UUID/payload. RED→GREEN coverage also keeps reconciliation reachable after a catalogue refresh archives the original category.
- [x] Ship `Breakdown` messages in EN/AR; preserve category archive-aware options, logical RTL/Amount bdi, SYP two-decimal inputs, Move dropdowns and explicit Received editing. Existing Move EN/AR tests still pass. Source-specific create inputs remain compatible; their insert responses select/return the actual final revision and reject unusable tokens, with tests. Salary-cycle source API integration remains item 5's later responsibility.
- [x] Append a revision-bearing `record_transfer` wrapper to reserved migration 003, moving the preceding scalar-return writer into unexposed `transaction_private`. Its existing profile-first/ordered-wallet locks, direct actual amounts and best-effort rate memo are preserved; public RPC returns `{id,revision}` in the same request. No applied preceding migration was edited. Apply only this newly appended wrapper section on the designated already-migrated PG17 test database, then rerun affected SQL tests: **69 currency + 45 breakdown assertions pass**, and the three multi-session breakdown races pass again. The parent will perform the final fresh combined replay.
- [x] Add composer/detail integration tests for EN/AR partial items, preserved payee, excess blocking, exact edit/Undo tokens, duplicate snapshot transfer, unknown-response retries and currency/type guards. Latest targeted selection: **114 tests pass across 15 files**. Scoped integration TypeScript analysis, file-scoped ESLint and diff whitespace checks pass. No global build/typecheck/lint run.
- [x] Fix the parent-browser-discovered demo fixture issue: bind 2000+3000 USD items to today's named USD Supermarket fixture rather than `index===0`, which shifted when SYP seeds were prepended. Two RED→GREEN regression tests independently require every itemized fixture sum to fit its cost and prove USD item text 20/30 while unitemized SYP 1250 minor units remains 12.5 pounds.
- [x] Author `e2e/expense-breakdowns.spec.ts` with EN/AR optional partial entry, preview behavior, saved-item edit/excess and duplicate checks. The parent reported passing partial/source browser paths while its auth/demo lane was managed centrally; saved demo cases exposed the fixture issue above, now fixed. This session starts no browser/server and runs no demo E2E against the parent's auth lane.
- [ ] Parent browser rerun for the corrected saved-demo fixture and screenshots at required widths/themes, real-phone keyboard/assistive checks, final combined checks/review. These remain unclaimed. Mechanical UI detector reports two advisory **pre-existing** transfer detail font sizes (34/22px) and no new breakdown-specific findings; preserve the existing transfer design rather than churn it in this feature.

Ruling: keep retry eligibility separate from new-entry catalogue validity: replaying an already committed unchanged draft is a read-only reconciliation, so newly archived categories cannot strand its Retry action. Ruling: use full actual history snapshots for installment detail; only synthetic fallback data uses `emptyTransactionMetadata()`. The shared lease is released after this handoff; no staged changes, commits, pushes, hosted writes or root-document edits were made by this session.

## Global Constraints

- Planning deliverable only in this session; no implementation, dependency/config changes, migrations executed, tests requiring servers, or commits.
- Preserve 390px mobile-first behavior and the 320/390/430/768/1280px mobile definition of done; EN/AR parity, logical RTL utilities, accessible 44px targets, 16px inputs, keyboard-visible Save, and existing Encaustic tile tokens.
- Names/descriptions use `<bdi>`; money uses existing `Amount`/`lib/money.ts` and `<bdi dir="ltr">`. USD cents and LBP whole lira stay separate; integer arithmetic only.
- Reads remain in server-only queries used by Server Components; writes remain zod-validated Server Actions returning `ActionResult`, using the publishable key plus the user's session.
- RLS on every new table; validate ownership in the database. No app secret/service-role key, no secret inspection, and no dependence on client-side validation.
- Append new migrations only. The orchestrator must allocate the actual migration filename after reconciling all round-3 work; do not infer the next number from older plans or existing future-dated filenames.
- Preserve read-only demo mode. Synthetic fixtures must not imply a successful database write.
- Preserve existing parent source metadata and installment/fixed/salary integrity rules; item lines do not become payments, transfers, categories, or nested expenses.
- Use the `impeccable` skill before future UI implementation, and provide the required mock/screenshot before a full new screen build. This proposal adds sections to existing sheets, not a new route.

## Review Focus

1. Parent amount reduced below the item sum: fail atomically and keep both the previous parent and every saved line unchanged (Tasks 1–3).
2. Cross-account identifiers or direct REST/RPC calls: no child reads/writes across tenants, including reparenting or changing `user_id` (Task 2).
3. Lost create response, two edits, or an edit racing delete/Undo: the same draft UUID cannot debit twice, and a stale action cannot overwrite newer parent/items, delete a later edit, or resurrect a deleted expense (Tasks 2–4).
4. Switching wallet currency or transaction kind with existing lines: no reinterpretation of cents as lira and no silent loss of lines (Tasks 2 and 4).
5. Soft delete/Undo, duplicate, generated fixed/installment expenses, and keyset pagination: preserve line association and count the parent exactly once (Tasks 2–5).

## Current implementation findings

| Current file/interface | Relevant behavior and implication |
| --- | --- |
| `src/features/transactions/schema.ts` | `TransactionInput` has `kind`, `occurredOn`, `walletId`, `amountMinor`, `categoryId`, optional `note`. `Transaction` adds currency, transfer fields, and `createdAt`; it has no children or concurrency token. Stored `RowKind` is expense/income/transfer; exchange uses transfer with different currencies. |
| `src/components/add/transaction-sheet.tsx` | `Form` serves add/edit/duplicate. Visible Name writes `note` (140 characters). `ComposerState` carries an initial `Transaction`; duplicate uses add mode with that initial row. Mode/wallet changes currently retain or truncate typed amounts and have no item safeguards. Save uses `useTransition`, one parent action, sticky `SaveBar`, and an Undo delete action. |
| `src/components/transactions/transaction-row.tsx` | Row title is `transaction.note || categoryName(...)`; one button opens the parent. Keep that title/payee and one amount. |
| `src/components/transactions/detail-sheet.tsx` | Detail has parent amount, wallet/date/name and Edit/Duplicate/Delete. Parent category is the heading, with Name in the detail list. Add an item section without replacing Name or deriving it from item descriptions. |
| `src/components/shell/composer.tsx` | `openDetail(Transaction)` stores the row; Edit and Duplicate pass that same object into the add sheet. Fetch complete items with each returned parent so these transitions cannot accidentally omit saved lines. |
| `src/features/transactions/actions.ts` | `createTransaction(input): Promise<ActionResult<{id:string}>>` and `updateTransaction(id,input): Promise<ActionResult>` write one row directly. `deleteTransaction`/`restoreTransaction` update `deleted_at`. `updateTransaction` currently reports success for a zero-row update; the new RPC must distinguish a missing/deleted/inaccessible target. |
| `src/features/transactions/queries.ts` | `fetchTransactions(filters,cursor,limit=30): Promise<Page>` selects flat `COLUMNS`, orders by date/created/id, and requests `limit+1` parent rows. `loadTransactions` in actions delegates here. Keep parent pagination, not a multiplying child join. |
| `src/features/transactions/group.ts` | `groupByDay` sums `signedMinor(parent)` per currency and excludes transfers. Child rows must never be fed to it as transactions. |
| `supabase/migrations/20261109000100_transfers.sql` | Latest replacement of `transactions_integrity()` copies currency from the wallet and validates wallet/category/transfer shape. `wallet_balances` sums only transactions. Extend by separate focused triggers where possible, rather than replacing this function from an obsolete migration. |
| `supabase/migrations/20261110000200_budgets.sql` | `month_category_spend(date)` aggregates live expense parents and rolls category children to top-level categories. No item join is needed for the recommended design. |
| `supabase/migrations/20261110000100_installments.sql` | `transactions_installment_check()` locks the installment and validates payment currency/remaining total. The new RPC must preserve `source`/`installment_id` and retain this trigger. |
| `src/features/categories/{schema,queries}.ts` | UI Category currently has no `parentId`; query returns only active top-level categories. Database supports subcategories. Item breakdown hierarchy is unrelated to category hierarchy. |
| `src/lib/{money,demo-data}.ts` | `MAX_MINOR = 1_000_000_000_000_000`; line sums can exceed safe JS integer range even when individual amounts do not. Demo transaction factories must gain explicit empty items/revision; demo budget totals are independent fixtures, not computed proof of live accounting. |
| `src/lib/supabase/{action,server}.ts` | Existing `actionClient()` authenticates and returns the session client; `ActionError` is a shared string union. The Supabase client is not currently parameterized with a checked-in generated Database type. Do not introduce a placeholder generated types file. |
| `e2e/phase3.spec.ts`, `playwright.config.ts`, `vitest.config.mts`, `supabase/tests/*.test.sql` | Browser suite is demo-only and starts Next automatically; it cannot prove persistence. Existing projects are mobile-small/android/iphone/desktop. Unit tests include `src/**/*.test.{ts,tsx}`. SQL tests run through `pnpm db:test`. |

There is no implemented Reports route/read model in the current source. Do not add Reports as part of itemization; record the parent-only aggregation contract for its later implementation. Older phase docs describe deferred routes and some stale auth behavior; current source and open-sign-up isolation rules take precedence.

### Installed Next.js references inspected

- `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`: Server Actions are public POST entry points; authenticate/authorize every call; current `startTransition` pattern is supported.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`: keep existing server-side `revalidatePath("/", "layout")` after successful writes; it refreshes the affected UI. No extra client refresh request is proposed.
- `node_modules/next/dist/docs/01-app/02-guides/data-security.md`: action arguments remain untrusted; keep data access in the server layer and return only required fields.

## Proposed design/spec

### Meaning and scope

An expense is still one payment: Name **Sister**, amount **$50**, one wallet, date and parent category. Optional items **Phone credits $20** and **For sister $30** describe that payment. They have no wallet, currency selector, date, payee, transaction kind, `source`, or children of their own. There is no second wallet debit and no separate Activity entry for an item.

**Recommendation: allow a remainder.** Require `0 <= sum(items) <= parent.amountMinor`; each existing item itself must be positive. Show a computed **Not itemized $30** when a $50 parent has only the $20 phone-credit item. With zero items, use the normal unitemized expense UI; do not persist a synthetic remainder row. Full equality shows **Fully itemized**. An excess blocks Save with an inline explanation; it never increases the parent total automatically. This supports quick entry and incomplete recollection while conserving the original payment.

**Recommendation: no item category in this increment.** The parent's required expense category classifies its full amount, including remainder. Descriptions answer “what did this comprise?” without introducing a second reporting meaning. Do not add a misleading category selector whose values reports ignore.

Alternatives considered:

| Alternative | Tradeoff |
| --- | --- |
| Require exact equality whenever any items exist | Strong completeness signal, but adding the first known item makes the whole expense temporarily unsavable; automatic filler lines become misleading. Keep equality as a visible status rather than a requirement. |
| Optional category per item with parent-category remainder | Useful future cross-category allocation, but budgets, category filtering, reports, subcategory rollups and archived-category history must all use one allocation model. If selected later, child amount replaces that share of parent-category spending; it must never be added on top. This is a consequential expansion, not an innocuous nullable field. |
| Child transactions under a parent transaction | Reuses ledger rows but risks double debits, duplicate Activity entries and recursive children. Separate descriptive item rows fit the requested semantics. |
| JSON stored directly on the transaction | Simpler atomic single-row write, but weaker independent relational ownership/shape constraints and awkward future category references. A small normalized table plus one RPC is recommended. |

Recommended bounds: 0–50 items; description trimmed, required, 1–140 characters; line amount integer `1..MAX_MINOR`; positions 0–49, unique per parent. UI ordering is insertion order; no drag/reorder feature is required. Duplicate descriptions are allowed. These limits are proposals and should be reviewed with the other round-3 input limits.

### Parent and item lifecycle

- Add/edit/remove items locally in the expense form; one Save persists the parent and complete final list. Removing a draft row does not post a separate write. Cancel leaves the database unchanged. Removing the final item restores ordinary expense behavior.
- Parent name/payee remains the existing optional Name/`note`, with category fallback when empty. Never overwrite it with item text, concatenated descriptions, or the first item's label.
- Increasing parent amount increases the computed remainder; decreasing it below the item total fails until the user explicitly edits/removes lines. Parent amount is authoritative.
- Same-currency wallet changes preserve lines and move the one parent debit according to existing ledger behavior.
- **Currency recommendation:** while saved items exist, require the person to remove all items and save before changing to another wallet currency. In a new draft, disable other-currency wallets until its item rows are removed. No implicit conversion, truncation or reinterpretation of line values. The server/database enforce the saved-item restriction too, even if a caller submits replacement lines.
- Switching Expense to Income/Move with item rows is disabled with “Remove the breakdown first”; no automatic discarded items. After clearing rows, income edits may save with `items: []`. Transfer creation remains the separate current action. Child metadata may attach only to an expense.
- Soft deleting a parent retains its stored item rows for Undo, hides them along with the parent, and removes only the parent debit/spend. Delete requires the displayed/captured revision; Undo restore requires the revision returned by that delete. A create Undo similarly deletes only the revision returned by the create. Later edits cause a conflict instead of being deleted/restored by an old toast. Items cannot be edited while parent is deleted. Future hard purge/account cascade deletes items through the FK; no orphan items. Any future purge that permits subsequent retries must retain a create-UUID tombstone or explicitly expire retries; physical cleanup must not silently enable resurrection under an old UUID.
- Duplicate copies parent Name/category/amount and item descriptions/amounts into a new draft, date defaulting to today as current duplicate does. Allocate a fresh client-generated transaction UUID; retries of that duplicate draft reuse it. Saving creates one new parent and new item IDs; the original remains independent. It never copies fixed/installment/source relationships.
- Fixed and installment templates are not itemized by this change. A posted expense generated by either can gain items through existing Activity Edit; the original source relationship stays intact and installment amount constraints still apply. Salary/income cannot have items.

### Mobile flow and presentation

Keep amount → Name → Category unchanged. Add a collapsed, optional **Breakdown** section below Category and above date details, expense-only. With zero rows its disclosure offers **Add item**; when itemized its summary says **2 items · Fully itemized** or shows the unitemized remainder using separate `<Amount>` elements (avoid mixed-direction string interpolation).

Expanded content uses vertically stacked item blocks, each with labeled Description and Amount text inputs and an accessible **Remove item N** button. Item amount uses `inputMode="decimal"` for USD and `numeric` for LBP, `dir="ltr"`, native keyboard/paste and `parseAmount`. Keep the existing custom keypad dedicated to the parent; do not redirect it ambiguously to the last focused line. New line focuses Description; removal focuses the next row or Add item. Use stable client-only keys for unsaved lines. Do not keep hidden invalid lines while permitting Save.

After the rows: Add item, Itemized total, optional Not itemized amount, and an inline sum error. At 50 rows disable Add item and show the limit explanation. Collapse does not erase rows or suppress validation. Parent Save remains accessible above the keyboard/safe area; if necessary relocate the existing SaveBar into the existing `SheetShell.footer` interface rather than changing all sheets globally.

Detail sheet shows parent Name/payee, category and full parent amount as today, followed by **Breakdown** with description/amount pairs and optional remainder. No per-item Edit/Delete navigation: use parent Edit. Activity/Home retain one row and the original title/amount; no item rows are expanded into the feed. Search/filter remain parent-based for this increment; item-description search is deferred and is not implied by showing items in details.

All new strings ship together in `src/messages/en.json` and `src/messages/ar.json`, preferably a scoped `Breakdown` namespace (title, description, amount, addItem, removeItem with ICU index, itemCount, itemizedTotal, remainder, fullyItemized, exceedsTotal, maxItems, removeBeforeCurrencyChange, removeBeforeKindChange, conflict). Arabic text receives native review during implementation. Use existing error/preview copy and explicit localized conflict/currency messages.

## Proposed data and API contracts

### Database

New `public.expense_items`:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null default auth.uid() references auth.users(id) on delete cascade`
- `transaction_id uuid not null`
- `description text not null`, trimmed/nonempty/140-character check
- `amount_minor bigint not null check (amount_minor between 1 and 1000000000000000)`
- `position smallint not null check (position between 0 and 49)`
- `(transaction_id, user_id)` composite FK to a new unique `(id,user_id)` key on `transactions`, `on delete cascade`; name it `expense_items_transaction_owner_fkey` for explicit read embedding.
- `unique(transaction_id,position)`; full-list replacement deletes before inserts, so an immediate unique constraint suffices.
- Index `(user_id,transaction_id,position)` for scoped reads; ensure parent lookup/cascade also uses an index beginning with `transaction_id` (the unique position key provides this).

No line currency column: read/format using the parent's currency. No nested parent field. Add `transactions.revision integer not null default 1`, with one before-update trigger setting `NEW.revision := OLD.revision + 1` on every parent update, including soft delete/restore. Ignore caller-supplied revision updates and reject changes to `transactions.id`/`user_id`, preserving stable create identity. This is the orchestrator-selected shared concurrency column/trigger; item 4 must reuse it, not add `version`. The existing transaction primary-key UUID is also the create-retry identity; do not introduce a separate `create_request_id` column or request-key API.

Use RLS select/insert/update/delete policies on items with `user_id = (select auth.uid())` and an owned, live expense parent check. `WITH CHECK` also applies to inserts/updates. Item `user_id` and `transaction_id` are immutable on update; replace a line rather than moving it. Reads of deleted parents' items are hidden; retain storage for Undo. Composite FK plus trigger checks prevent an owned line from pointing at someone else's parent. No public/anon execute grant on mutation RPCs.

**Atomicity and direct-write invariants:**

1. Every item insert/update/delete locks its parent row `FOR UPDATE` in `expense_items_lock_parent()`. Validate that the parent is an owned live expense; reject mutation otherwise. Item changes touch the parent so its revision advances, including direct authenticated DML. Handle FK/account hard-delete cascades when the parent no longer exists without blocking cleanup.
2. Deferrable, initially-deferred constraint triggers on item changes and parent updates call `expense_breakdown_check()` at final transaction state: for an existing parent, count ≤50, numeric SQL `sum(amount_minor)` ≤ parent amount, and any nonempty breakdown implies expense kind. This narrowly scoped trigger function uses `security definer`, fixed empty search path and fully qualified relations, with execute revoked from PUBLIC/anon/authenticated. Read only the parent/owner pair derived from the triggering OLD/NEW record, never caller-supplied lookup arguments. This allows checking retained lines even when child SELECT RLS hides a soft-deleted parent's items. Ignore a physically removed parent during cascade cleanup. SQL aggregation must not cast a potentially huge sum to bigint before comparing. The public save RPC remains security invoker.
3. A focused parent guard rejects currency changes whenever saved items exist, before those items can be deleted/reinserted to bypass the restriction; the RPC explicitly checks the pre-edit saved state too. Do not assume incoming `currency` is trustworthy: compare old parent currency with the destination wallet currency after resolving the owned wallet. Preserve the existing wallet/category/installment integrity triggers and their ordering.
4. Full-list save locks the parent before touching children. Deferred checks permit a valid simultaneous amount/list edit without rejecting its intermediate state. Direct parent shrink/kind changes also face the final-state constraint; UI-only or RPC-only validation is insufficient.
5. Parent row locks serialize concurrent writes; optimistic revision prevents a stale whole-list editor from erasing another edit. Concurrent direct item writes must advance revision under that lock. A deadlock from a direct child write versus parent replacement may abort one transaction; no partial mutation or invalid sum may commit. Return a retryable generic failure rather than report success, and test this path.

Canonical baseline RPC selected by the orchestrator, `security invoker`, `set search_path = ''`, schema-qualified relations/functions:

```sql
public.save_transaction(
  p_id uuid,
  p_expected_revision integer,
  p_input jsonb,
  p_items jsonb
) returns table (id uuid, revision integer)
```

`p_id` is always a nonnull, validated client-generated transaction UUID (or the existing row UUID on edit). `p_expected_revision = null` means create/retry; a positive nonnull revision means guarded update. Never use null ID to select create. Derive owner solely from the authenticated session; there is no owner parameter. `p_input` is a strict JSON object with the existing editable camelCase keys `{kind,occurredOn,walletId,amountMinor,categoryId,note?}`; `kind` accepts only expense/income here. Separate `items` belongs in `p_items`, not in `p_input`. Validate required keys, unknown keys, JSON scalar types, dates and all money limits in SQL too. Normalize `note` by trimming and mapping omitted/empty to null exactly as the action does.

**Create and retry:** Serialize generic creates for the supplied UUID with a transaction-scoped advisory lock (e.g. `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transaction-create:' || p_id::text, 0))`); hash collisions only serialize unrelated requests, never confer ownership. Under that lock, first look up/lock an owned existing parent, including deleted rows, and perform the replay comparison below before any attempted INSERT. If no owned row exists, insert the supplied UUID with session ownership using `ON CONFLICT (id) DO NOTHING`; after a conflict, perform only an owner-scoped locked lookup and fail generically if inaccessible. This fallback covers a privileged/direct insertion outside the advisory protocol without leaking another owner's data. A successful new insert creates the complete item list atomically and returns final `{id,revision}`. Require an existing replay target to be live, manually created (`source` and source-link IDs null), and exactly equal to the submitted normalized parent fields plus complete positional item descriptions/amounts. Creation's null item list normalizes to []; compare item content/order, not regenerated child IDs. Item 4 adds the normalized settlement snapshot to this equality check. Identical replay returns the same ID and current final revision **without writes**, child-ID churn, revision increment, additional wallet effect, or fresh Activity row. A changed parent/list/settlement, a soft-deleted row, or any mismatching replay fails with conflict; it must never overwrite or restore a row. Concurrent same-ID creates converge on that same comparison after the first transaction commits. Do not use upsert/DO UPDATE for create retries. An owned replay must be recognized before attempting INSERT: BEFORE INSERT integrity triggers run even on an insert that would hit a conflict, and otherwise a newly archived original wallet could incorrectly block a read-only identical replay. Apply wallet/category availability checks to an actual new create, not an unchanged live replay.

**Update:** Lock the owned live parent, compare the supplied revision, and fail for a stale/missing/deleted parent. Update only editable parent fields: do not overwrite `source`, `fixed_expense_id`, `installment_id`, created timestamp, ID, owner or deleted state. Transfers remain outside this save RPC. Return the actual final revision after all item touches, never assume a save advances by exactly one.

`p_items = null` on update means preserve saved items for compatibility with non-item-aware callers; `[]` explicitly clears; array means replace the entire list. Validate array/object shapes, allowed keys and scalar types, count, text, integer bounds and sums in SQL as well as zod. Derive positions from array ordinality and user/parent IDs server-side; never accept ownership, wallet, currency, kind, parent or children from a line object. Reject lines for non-expense kind. Precheck saved-item currency lock before replacement. For a replacement, delete old lines, update parent, insert new lines within the same RPC transaction, and return the final revision after line touches. Any exception rolls back all work; do not catch-and-return success or split writes among Server Actions. Recreated internal line IDs are acceptable because no outside relation references them.

Use distinct stable SQLSTATE/message identifiers for `breakdown exceeds total`, `breakdown currency locked`, and `transaction conflict`, with generic missing/inaccessible target handling. Grant RPC execute to authenticated only; revoke from PUBLIC/anon. This is an invoker function, so retain the required authenticated table privileges and enforce each direct mutation through RLS/triggers; revoking child DML would also break this invoker RPC. Trigger functions are not executable as public RPC endpoints.

Canonical lifecycle RPC, defined in this baseline rather than independently by item 4:

```sql
public.set_transaction_deleted(
  p_id uuid,
  p_expected_revision integer,
  p_deleted boolean
) returns table (id uuid, revision integer)
```

Require a nonnull positive expected revision, authenticate, lock the owned parent (including soft-deleted state), compare revision **before** inspecting the requested state, and update only `deleted_at`. Wrong owner, missing row, or stale revision returns a generic conflict/failed result without success on zero affected rows. If the exact current revision already has the requested state, return it as a no-op; never accept an older revision just because the state happens to match or `current=expected+1`. That arithmetic cannot prove which mutation occurred. A lost lifecycle response therefore requires reload/reconciliation, not blind stale retry or a fresh current-revision lookup inside the action. Actual delete/restore returns the new revision; children are retained and their visibility follows the parent. Restore runs existing source/installment guards; item 4 additionally rechecks source/change wallets and settlement rules. Use the same invoker security/grants as save; no unchecked legacy mutation fallback.

**Item 4 extension contract:** In its orchestrator-numbered append-only migration, append only `p_settlement jsonb default null` to the four-argument save contract above. Replace the old exact function signature and restore grants in that migration so PostgREST does not see ambiguous overloads; callers using the four named arguments continue working through the default. `null` means no settlement on create/preserve on edit; `{}` explicitly clears; a strict settlement object replaces. Revalidate cost/items/settlement together. Extend same-UUID create equality to settlement (null create means plain settlement, so it cannot replay a settled row as an identical plain create). No extra request-ID argument, `save_purchase`/`savePurchase`, second revision column/trigger or competing delete RPC. This orchestration decision supersedes item 4's older nine/eleven-argument/request-key proposal as inspected during this integration review.

### TypeScript

Extend `src/features/transactions/schema.ts`:

```ts
type ExpenseItemInput = { description: string; amountMinor: number };
type ExpenseItem = ExpenseItemInput & { id: string; position: number };
// TransactionInput: add items?: ExpenseItemInput[]; omitted preserves on edit.
// Transaction: add revision: number; items: ExpenseItem[]; always [] if absent.
```

Define/export `expenseItemInputSchema` and extend `transactionInputSchema` with a 50-item max and a refinement rejecting nonempty income items or a sum above `amountMinor`. Use `BigInt` internally to sum up to 50 individually valid integers; never serialize a BigInt through React/JSON. Add `src/features/transactions/breakdown.ts`:

```ts
type BreakdownSummary =
  | { valid: true; itemizedMinor: number; remainderMinor: number }
  | { valid: false; reason: "exceedsParent" };
function summarizeBreakdown(
  parentMinor: number,
  items: readonly ExpenseItemInput[],
): BreakdownSummary;
```

Only convert the bounded sum to Number once it is ≤ the already-validated parent amount. Draft invalid amount text stays in the UI; validate each line before calling the helper. Empty list yields itemized 0/remainder parent.

Define the controlled editor's exact draft contract alongside the summary helper in `breakdown.ts`:

```ts
type ExpenseItemDraft = { key: string; description: string; amountText: string };
type ExpenseItemDraftResult =
  | { valid: true; items: ExpenseItemInput[]; summary: Extract<BreakdownSummary, {valid:true}> }
  | { valid: false; reason: "invalidParent" | "invalidItem" | "exceedsParent" };
function parseExpenseItemDrafts(
  currency: Currency,
  parentMinor: number | null,
  drafts: readonly ExpenseItemDraft[],
): ExpenseItemDraftResult;
```

Use `parseAmount` plus the line schema; never silently filter invalid rows. Parent Form and editor derive this result on every render, so a parent amount/currency change cannot leave a stale validity flag. Editor props are `{currency: Currency; parentMinor: number | null; items: ExpenseItemDraft[]; onChange: (next: ExpenseItemDraft[]) => void; disabled?: boolean}`. Detail renderer props are `{items: readonly ExpenseItem[]; parentMinor: number; currency: Currency}`. All types/helpers named here are exported for the caller/tests.

Canonical action signatures:

```ts
type TransactionMutation = { id: string; revision: number };
createTransaction(input: TransactionInput, draftId: string): Promise<ActionResult<TransactionMutation>>;
updateTransaction(id: string, input: TransactionInput, expectedRevision: number): Promise<ActionResult<TransactionMutation>>;
deleteTransaction(id: string, expectedRevision: number): Promise<ActionResult<TransactionMutation>>;
restoreTransaction(id: string, expectedRevision: number): Promise<ActionResult<TransactionMutation>>;
```

`draftId` is required; the action must never generate a fresh ID on each request. Both save actions validate with zod and `actionClient`, split `input` into strict `p_input` and `p_items`, then call save once; create sends `(draftId,null,...)`, update `(id,expectedRevision,...)`. Delete/restore validate arguments and call `set_transaction_deleted` once with true/false, never fetch-and-adopt the latest revision or fall back to direct unchecked updates. Add shared errors `breakdownExceedsTotal`, `breakdownCurrencyLocked`, `conflict` in `src/lib/supabase/action.ts`; map only known database codes and otherwise return `failed`.

Composer stores a stable `draftId = crypto.randomUUID()` per genuinely new or duplicate draft, retained across rerenders and transport failures (including a retained draft's component remount). Keep the UUID in `ComposerState` owned by `src/components/shell/composer.tsx`, not an expression evaluated per Save. Retain the attempted normalized payload for exact retry after a lost/unknown response; do not silently allocate another ID if the user edits fields before resolving that attempt. Resolve by retrying the original snapshot or reloading the existing UUID; a mismatching retry conflicts and preserves the draft. A deliberate new purchase/cancel-and-start-new allocates a fresh UUID. Guard synchronous double activation with an in-flight ref as well as pending UI; database idempotency remains authoritative.

Source-specific `receiveSalary()`, `payFixedExpense(id)`, `payInstallment(input)` retain their existing inputs, generation behavior and direct source-aware inserts; they are not routed through the manual-create RPC or required to accept a draft UUID. Additively broaden their successful results to `{id,revision}` and select the inserted revision so their current Undo callbacks can pass the captured revision to the common guarded delete action. Existing id-only result consumers remain structurally compatible. Do the same additive return update for `createTransfer(input)` and its composer Undo. These are lifecycle integration changes, not new create-retry semantics for source generators/transfers. No unchecked optional-revision overload remains; every Undo uses the revision returned by its own creating/deleting action.

Extend the existing `COLUMNS` projection with `revision` and nested `expense_items!expense_items_transaction_owner_fkey(id,description,amount_minor,position)`, map database `amount_minor` to validated integer Number and sort items by `position`. This nested to-many projection must leave the parent limit/cursor unchanged. Do not join children into flat transaction results or run one query per row. Returned parent rows from Home, Activity and load-more all contain complete item arrays. Maximum payload is bounded by page size ×50; measure it with dense synthetic fixtures during implementation and avoid extra decoration in the feed projection.

## Implementation tasks

### Task 1: Define item contracts and exact sum validation

**Files:** Modify `src/features/transactions/schema.ts`; create `src/features/transactions/breakdown.ts`, `src/features/transactions/schema.test.ts`, `src/features/transactions/breakdown.test.ts`.

**Consumes:** `MAX_MINOR`, `parseAmount`, existing TransactionInput.

**Produces:** `ExpenseItemInput`, `ExpenseItem`, schema extension, `summarizeBreakdown`, and the draft types/`parseExpenseItemDrafts` above; no financial side effects.

- [ ] Add failing unit assertions: parent 5000 with [] → 0/5000; [2000] → 2000/3000; [2000,3000] → 5000/0; [2000,3001] fails; valid max parent with one max line passes; 50 max lines fails without Number rounding/overflow.
- [ ] Add schema cases for whitespace-only description, >140 chars, zero/negative/fractional/unsafe amount, >50 lines, and nonempty income items. Missing items remains accepted; `[]` explicitly accepted. Unknown financial/hierarchy fields on line objects are rejected rather than treated as meaningful data.
- [ ] Run `pnpm exec vitest run src/features/transactions/schema.test.ts src/features/transactions/breakdown.test.ts`; expect failing assertions before implementation, then implement the contracts/refinements/helper and rerun for PASS.
- [ ] Keep input parsing through `money.ts`; verify existing Arabic-Indic parsing tests plus draft-parser cases accepting `"٢٠٫٠٠"` as 2000 USD minor units, rejecting LBP decimals/blank rows/blank descriptions, and recomputing validity after parent changes. No currency addition/conversion in the summary helper.

### Task 2: Add atomic persistence, RLS and invariant enforcement

**Files:** Create `supabase/migrations/<orchestrator-allocated>_expense_breakdowns.sql`, `supabase/tests/expense-breakdowns.test.sql`; modify `supabase/tests/isolation.test.sql`. Add a focused local-only concurrency harness at `supabase/tests/expense-breakdowns-concurrency.mjs` if the existing pgTAP runner cannot exercise overlapping sessions.

**Consumes:** Proposed data/RPC contracts above; current transaction/source/installment constraints.

**Produces:** expense_items table, single parent revision support, RLS, focused guard/lock/deferred-check triggers, four-argument `save_transaction` with stable-UUID create retries, and `set_transaction_deleted`.

- [ ] Write pgTAP fixtures for two synthetic users, USD and LBP wallets, a parent 5000 expense named Sister, and the 2000+3000 item example. Assert one parent row, two items, parent name unchanged, wallet delta -5000, one expense total of 5000 in `month_category_spend`, zero independent child ledger entries.
- [ ] Pin partial/empty/equal/over-sum behavior and rollback: invalid second item leaves no newly created parent; invalid replacement leaves original parent amount/name/revision and item list unchanged; 5000→6000 increases remainder, 5000→4000 with 5000 in items fails, combined amount/list reduction to 4000 succeeds.
- [ ] Pin baseline idempotency: a supplied UUID and null expected revision creates one parent; identical sequential replay returns the same ID/current final revision without writing or changing item IDs; changed amount/name/date/wallet/category/item content/order conflicts; replay after soft delete conflicts and never restores. Replays ignore unchanged wallets' later archived status because they do not create a new payment. Reusing another user's UUID fails generically with no data disclosure; null UUID and malformed strict `p_input` fail. Assert counts, balances, revisions and saved item IDs before/after, not only action status.
- [ ] Pin RLS/direct-write tests: B cannot select A's items, insert against A's parent with B or A `user_id`, update/delete A's line, reparent an owned line, or use foreign wallet/category in the RPC. Assert no state change after inaccessible writes, not just error presence. Anonymous cannot execute the RPC.
- [ ] Pin lifecycle/guard tests: direct parent amount/kind change cannot invalidate saved items; direct line insertion/edit above total fails; same-currency wallet move succeeds; different-currency edit with saved items fails even when replacement lines are supplied; after a separate successful clear save, currency change succeeds; soft delete hides child reads and reverses only 5000; restore returns the same lines/debit; hard-delete/account cascade creates no orphan or cleanup error.
- [ ] Pin `set_transaction_deleted`: delete uses displayed revision and returns new revision; restore uses returned deletion revision; exact-current-revision same-state request is a no-op; stale revision always conflicts even when `current=expected+1` and requested state matches. Create Undo captured before a later edit cannot delete it; stale restore cannot resurrect a subsequently changed/deleted aggregate. Missing/foreign row cannot return success. Reject ID mutation on existing parents. Verify returned revision after item replacement may exceed initial+1 and is the token used for lifecycle actions.
- [ ] Pin source integration: add lines to an existing fixed-generated expense without changing source IDs; installment payment with items still reduces installment remaining once and rejects a parent payment over the installment balance; direct income/transfer item attachment fails. Source-generated rows cannot be claimed as successful manual-create replays merely because editable fields match. Validate count/description/amount limits on SQL entry points, not just in TypeScript.
- [ ] Implement migration without modifying earlier migrations or disabling their triggers/RLS. Add exactly one revision trigger as a focused before-update trigger; item touches must not recurse into item writes. Implement strict four-argument save/create-replay comparison and guarded lifecycle RPC; no request-ID column, `version`, save_purchase function or direct unchecked lifecycle fallback. Make deferred checks final-state aware and retain parent lock ordering in normal RPC use.
- [ ] With an authorized local disposable Supabase available, apply the appended migration and run `pnpm db:test`; expect all pgTAP suites PASS, including budgets/installments/isolation. Do not run `db:reset` against a database holding user data; do not infer a live migration has been applied from docs.
- [ ] Implement/run `node supabase/tests/expense-breakdowns-concurrency.mjs` against local test-only connections: identical simultaneous same-UUID creates return one aggregate with the same ID/final revision and one debit; conflicting same-UUID creates cannot both succeed; two updates with the same expected revision yield one success and one conflict; item insertion race for the last remainder cannot commit both; edit versus delete/Undo cannot overwrite/delete a later revision; simultaneous parent replacement/direct line edit yields valid final state or one rolled-back retryable failure. Use separate database sessions, barriers/locks and assertions on final totals, not timing sleeps. Harness uses only explicit local test connection settings and refuses non-loopback targets.

### Task 3: Wire actions and complete parent reads

**Files:** Modify `src/features/transactions/{actions,queries,schema}.ts`, `src/lib/supabase/action.ts`, `src/lib/demo-data.ts`, `src/features/transactions/group.test.ts`; additively update successful return data in `src/features/{salary,fixed,installments}/actions.ts`; create `src/features/transactions/actions.test.ts`, `src/features/transactions/queries.test.ts`.

**Consumes:** Task 1 contracts and Task 2 RPC/revision/embedded FK relation.

**Produces:** Stable-ID create and revision-aware update/delete/restore action signatures defined above; additive revision returns from source generators/transfer; complete `Transaction.items` on all fetched pages.

- [ ] Add action tests with mocked session client: malformed lines/UUID/revision fail before DB access; demo mode returns `notConfigured`; create uses the caller's unchanged draft UUID and null revision, edit uses its nonnull expected revision, both with strict parent `p_input` and separate `p_items`; omitted items map to null, clear maps to []; stale/replay mismatch maps to conflict; failed RPC never revalidates; success revalidates once and returns exact final revision. Delete/restore issue only the guarded RPC with the passed token and true/false; no latest-revision fetch, unchecked fallback or zero-row success. Mock `server-only`/Next as needed within the existing Vitest setup, without global configuration churn.
- [ ] Replace parent create/update and direct delete/restore writes with the canonical invoker RPCs. Add required draft UUID / expected-revision arguments and full mutation results. Keep transfer and source-specific create inputs/generation behavior unchanged; select/return their inserted revision additively for safe Undo. Preserve source fields and current broad layout revalidation after success; no follow-up `router.refresh()`.
- [ ] Add mapper/query tests for nested arrays, numeric-string amount inputs, stable line order, absent items→[], income/transfer→[], and two items leaving one parent row with the same keyset cursor. Verify load-more uses the same projection; no per-parent N+1 query.
- [ ] Extend demo factories (`build`, `demoTransfers`) and `group.test.ts`'s `tx` helper with revision/items; add a synthetic itemized expense (prefer enriching an existing sample so unrelated row-count assumptions do not drift). Keep preview Save failure behavior. Grouping test: one 5000 parent with 2000+3000 items still gives USD -5000 and one row.
- [ ] Run `pnpm exec vitest run src/features/transactions src/lib/money.test.ts` and inspect results; expected PASS. Check all create/update/delete/restore action call sites supply the correct stable UUID/captured revision, source create result shapes remain compatible, and every Transaction literal satisfies the expanded type.

### Task 4: Add optional editor and detail breakdown

**Files:** Create `src/components/add/expense-breakdown-editor.tsx`, `src/components/transactions/expense-breakdown.tsx`, `src/components/add/expense-breakdown-editor.test.tsx`; modify `src/components/add/transaction-sheet.tsx`, `src/components/transactions/detail-sheet.tsx`, `src/components/shell/composer.tsx`, `src/components/salary/salary-card.tsx`, `src/components/fixed/fixed-card.tsx`, `src/components/installments/installment-pay-sheet.tsx`, `src/messages/{en,ar}.json`; modify `src/components/transactions/transaction-row.tsx` only if needed to preserve the stated one-row contract (no new count badge required).

**Consumes:** Task 1 summary/types, Task 3 complete initial items/revision/actions, existing SheetShell/TextField/Amount.

**Produces:** `ExpenseBreakdownEditor({currency,parentMinor,items,onChange,disabled})` and `ExpenseBreakdown({items,parentMinor,currency})` with the exact props defined above. Draft keys are never sent to SQL; `items` persisted by the parent are only description/minor amount.

- [ ] Apply the UI skill/design contract and show the planned sheet states for implementation review: collapsed ordinary expense, partial breakdown, exact breakdown, invalid excess, long Arabic description/large LBP. Keep all work within existing tokens and sheet structure.
- [ ] Add failing component tests (per-file jsdom environment) for add/edit/remove, focus after insertion/removal, collapse retaining edits, invalid row and excess disabling parent Save through the shared parser, max count, and remaining amount changing when parent total changes. A small Form harness uses `parseExpenseItemDrafts` on every render to prove invalid rows cannot become silently dropped items or stale validity flags.
- [ ] Implement the stacked editor/disclosure with line validation and exact sum summary. Use native keyboard text inputs for lines and keep parent keypad independent. Extend parent canSave and localized errors, pass full parsed items and expected revision on Save; preserve drafts on server errors/conflict instead of closing as if saved.
- [ ] Extend add-mode `ComposerState` with required `draftId:string`; assign once through `crypto.randomUUID()` in `openAdd` and deliberate Duplicate/top-up entry points. Retain it across rerenders/retained-draft remounts and transport failure; pass it to `createTransaction`. Snapshot an in-flight/unknown-outcome payload for exact retry; pending plus a synchronous ref prevents duplicate activation. Test lost first response followed by retry uses the same ID/payload, a deliberately new draft gets a new ID, and editing an unresolved attempt never silently creates a second parent.
- [ ] Initialize edits/duplicates from all saved lines; use fresh draft keys and no persistent item IDs in the mutation payload. Keep edit date versus duplicate-today behavior, parent Name, and parent category unchanged. A conflict keeps edits visible and offers close/reopen to refresh rather than silently retrying stale data.
- [ ] Guard mode/currency switches as specified. For an existing itemized parent, even after local row removal keep other-currency wallet options disabled until the clear is saved/reopened; same-currency wallets stay usable. Explain the rule inline. Remove item rows explicitly before kind change; never silently submit [] merely because the section is hidden.
- [ ] Add the read-only Breakdown section and remainder in detail with long text wrapping, full amounts and `<bdi>`; preserve parent Name/payee and one parent amount. Copy through existing Edit/Duplicate callbacks without stripping items/revision. Detail Delete passes the displayed revision, its Undo restore passes the successful delete's returned revision; create/transfer/source-specific Undo callbacks pass their successful creation's returned revision. Surface lifecycle conflict without removing newer content or retrying with a fetched revision. Do not assume final revision equals starting+1.
- [ ] Complete both message files and run `pnpm exec vitest run src/components/add/expense-breakdown-editor.test.tsx src/messages/messages.test.ts`; expect PASS.

### Task 5: Verify complete flows and document accounting boundaries

**Files:** Create `e2e/expense-breakdowns.spec.ts`; modify `e2e/phase3.spec.ts` only for actual changed expectations; update `docs/ARCHITECTURE.md`, `docs/MOBILE-UX.md`, `docs/PLAN.md` after implementation. No new Reports code or changes to spending SQL required under the recommended no-line-category design.

**Consumes:** Completed data/action/UI contracts and a dense synthetic demo fixture.

**Produces:** Evidence that ordinary logging stays fast and itemization stays descriptive.

- [ ] Add demo e2e cases for EN/AR: add stays collapsed by default; $50 parent/$20 item shows $30 remainder; $20+$30 fully itemized; $20+$30.01 prevents Save; item description and amount edits/removal update validity; ordinary income/move never has the editor; guarded currency/kind change; detail→edit/duplicate preserves parent Name and all items. A valid preview Save reports the existing database-not-configured error and keeps the draft visible. Do not assert demo writes persisted.
- [ ] Add long Arabic/English descriptions and 10-digit LBP amounts, both themes, reduced-motion, keyboard focus, 44px remove controls and Save reachability. Review screenshots at 390px EN/AR plus 320/430/768/1280 layout checks. Use `e2e/support.ts` overflow assertion and the existing iPhone/mobile-small projects; add per-test viewport variants for absent widths rather than altering shared config without coordination.
- [ ] In the authorized local authenticated fixture, perform create→reload→edit→reload→delete→Undo→duplicate. Assert one 5000 debit/spend and one Activity row for the original, same-name original and separate duplicate only after saving it, independent item IDs, and unchanged currency totals. SQL tests remain the accounting source of truth; browser demo checks cannot substitute for this. Do not test against real financial data.
- [ ] Add authenticated integration checks for a committed create whose response is lost then retried with the same UUID, and create Undo after a later edit. The first leaves one parent/debit and returns the same final revision; the second reports conflict and preserves the edit. Check salary/fixed/installment/transfer Undo still works with their additive revision results and does not bypass revision guards.
- [ ] Run targeted unit/SQL/browser commands below and review screenshots. Once targeted checks pass, run `pnpm typecheck`, `pnpm lint`, and the existing transaction/budget/installment browser regression paths. Record actual outputs and any environment limitation; never mark a blocked live check as passed.
- [ ] Update architecture with the descriptive-item/parent-only spend contract and new RPC; update Mobile UX with the optional section and lifecycle rules; update project progress only for completed work. State that future Reports and cashier settlement must not aggregate item amounts as additional expenses.

## Shared work and sequencing for the orchestrator

1. Reconcile this spec with item 1 categories and item 4 cashier settlement before schema implementation. Recommended items have no category, so category management can ship independently after agreeing how parent archived/subcategory selections behave. Itemization must not become a workaround for category allocation without an explicit expanded reporting plan.
2. Item 4 owns actual cash-flow settlement (amount tendered/change/wallet movements), whereas item 2 owns purchase composition. The same $50 purchase may have items totaling $50 and settlement money movements with entirely different totals; never infer item amounts from cash handed over or use items as settlement legs. Item 4 may supersede which parent/cash-flow rows affect balances; integrate the one-payment accounting contract there without giving descriptive items wallet effects.
3. Orchestrator-selected canonical baseline is one `transactions.revision integer`/trigger, `save_transaction(p_id uuid,p_expected_revision integer,p_input jsonb,p_items jsonb)` and `set_transaction_deleted(p_id uuid,p_expected_revision integer,p_deleted boolean)`, both returning `{id,revision}`. Required nonnull stable `p_id` identifies both create and replay; null expected revision selects create, nonnull selects guarded update. Item 4 appends only optional settlement JSON to this save contract and extends lifecycle checks; no separate request key, version field, save_purchase API or unchecked lifecycle path. This supersedes its earlier incompatible proposal. Coordinate migration ordering and `transactions_integrity()` interactions without replacing triggers from stale definitions.
4. Shared edit hotspots: `src/features/transactions/{schema,actions,queries}.ts`, `src/components/add/transaction-sheet.tsx`, `src/components/transactions/detail-sheet.tsx`, `src/components/shell/composer.tsx`, source-generating actions and Undo callbacks in salary/fixed/installments, `src/lib/{demo-data.ts,supabase/action.ts}`, both message files, migration allocation, `supabase/tests/isolation.test.sql`, and later architecture/UX/progress docs. Sequence shared edits or have a single integration owner; do not revert parallel changes.
5. Fixed/installment/salary generation remains compatible because items are optional and default empty; existing create inputs/behavior/source relationships stay intact. Additive revision results allow every Undo to share the guarded lifecycle action. Do not require those generators to accept the manual composer UUID or imply retry-safe creation for them in this scope. Reuse the one shared revision and adjust type/test factories together. No dependency on unfinished Reports or a new transaction detail route.

## Verification commands and status

**Actually done during planning:** read repository instructions, product/architecture/mobile/design docs, applicable installed Next.js guides, current transaction/category/budget/installment code, SQL migrations/tests, demo/e2e setup, and git working-tree status. Integration review also read `04-cashier-payments-and-change.md` and source-specific create/Undo call sites, then reconciled this plan to the orchestrator-selected canonical RPC/retry/lifecycle contracts. No secrets opened. No product tests, builds, migrations, servers, stage/commit/push, or product code changes run/made in this planning session.

**Planned for implementation (not run here):**

```powershell
pnpm exec vitest run src/features/transactions src/lib/money.test.ts src/components/add/expense-breakdown-editor.test.tsx src/messages/messages.test.ts
pnpm db:test
node supabase/tests/expense-breakdowns-concurrency.mjs
pnpm exec playwright test e2e/expense-breakdowns.spec.ts --project=iphone --project=mobile-small
pnpm exec playwright test e2e/phase3.spec.ts e2e/budgets.spec.ts e2e/installments.spec.ts
pnpm typecheck
pnpm lint
```

Database commands require a disposable authorized local test database with all coordinated migrations applied. The concurrency harness is a proposed new test tool, not a currently runnable repository command. Playwright starts a demo server via existing config; the authenticated persistence check needs a separate local test fixture and session. Follow Mobile UX's accessibility requirement; the current checkout has no dedicated axe command/dependency, so coordinate the existing approved accessibility tooling instead of claiming an axe check ran or silently adding packages.

## Material choices for consolidation

- Recommended remainder rule is partial itemization (`sum <= parent`), not mandatory equality. The owner has not approved this yet.
- Recommended first release has description + amount only, with all category spend staying on the parent. If item-specific categories are expected to affect budgets/reports, that is a larger coordinated allocation feature.
- Recommended currency rule requires a separate saved clear before switching currencies on an already itemized expense, favoring avoiding silent unit changes over a faster conversion workflow.
- Migration identifiers and serialized shared-file ownership remain orchestrator integration decisions. The canonical save/lifecycle signatures, stable-UUID create retry behavior and one integer revision column/trigger have now been selected by the orchestrator above; they are no longer unresolved naming choices. Strict stale lifecycle rejection is the safe baseline; any future idempotent lifecycle retry would need an actual mutation identity, not revision+1 inference.

Self-review complete: the requested optional one-level model, preserved parent payee, add/edit/delete and parent lifecycle, remainder policy, category alternative, one debit/no double-counting, parent currency, exact safe sums, atomic writes, isolation/direct-write controls, demo behavior, mobile/RTL parity, and planned verification all have owning tasks above. No separate spec or unapproved implementation was created.
