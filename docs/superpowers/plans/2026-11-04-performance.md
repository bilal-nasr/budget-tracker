# Performance fixes implementation plan

**Goal:** Resolve the six findings from the performance audit, starting with shared JavaScript and wallet balances.

**Architecture:** Preserve the existing UI, financial calculations, RLS, revision checks, and salary-cycle snapshot semantics. Defer optional code and history, stream independent dashboard sections, and keep long activity feeds inexpensive to render.

**Constraints:** Preserve existing uncommitted work. Initial implementation made no commits or production database writes. The follow-up release explicitly authorized migration application, a performance-only commit, and pushing to main. New database behavior uses append-only migrations tested against disposable PostgreSQL.

## Tasks

- [x] Lazy-load composer sheets on first use, retaining mounted drawer roots after closing for exit animations. Verify cold bundle size and open/close/reopen flows.
- [x] Replace wallet balance JSON extraction with typed columns in a new security-invoker view migration. Verify financial equivalence, RLS, and the change-wallet index plan.
- [x] Return compact coherent installment summaries for Home/Budgets; fetch canonical revision-bearing installment history on demand.
- [x] Remove global loan-event reads from the loan list; load bounded history on demand without weakening latest-payment or restore rules.
- [x] Isolate activity search renders and bound offscreen rendering work; reuse Intl formatters. Verify paging, filtering, and formatting.
- [x] Stream independent Home sections and start independent reads before awaiting the profile. Verify slow-data boundaries and existing Home flows.
- [x] Run unit tests, lint, typecheck/build, targeted mobile/desktop browser checks, and disposable SQL regression tests. Measure the final cold bundle and record remaining limits.

## Review focus

- First open, close animation, immediate reopen, and nested wallet creation preserve sheet behavior and draft identity.
- Cashier tender/change, transfers, loans, deletion/restore, and cross-user isolation preserve exact balances.
- Initial null salary cycle differs from unavailable data; historical detail always carries canonical transaction revision/items.
- Late history responses and mutation refreshes cannot replace newer data or enable an invalid loan undo/restore.
- Search stays responsive while paging; both locales, keyboard access, and day totals remain correct.


## Verification and measured results

- `pnpm test`: 57 files / 492 tests passed.
- `pnpm lint`: passed after excluding generated `.impeccable` artifacts.
- Production demo browser checks: 186 passed, Android and desktop, English and Arabic; existing smoke, transaction, salary, fixed, installment, budget and loan flows.
- `node scripts/test-performance.mjs`: passed on disposable PostgreSQL 17. All migrations apply in order. Exact wallet balances, deletion/restore, RLS, index usage, installment summary/full-history equivalence across receipt states, loan ordering facts and keyset history checked.
- Wallet balance fixture (10,003 transactions): about 49 ms before / 1.2 ms after; the plan uses `transactions_change_wallet_idx`. These are local test timings, not production latency claims.
- Initial modern-browser script tags, individually gzip-compressed, same measurement as audit: Home EN/AR 301.3 -> 227.0 KiB; Wallets 296.1 -> 218.7 KiB; Settings 295.4 -> 186.4 KiB. Excludes legacy `nomodule` scripts and later route prefetches.
- Independent read-only review: no blocking correctness or regression findings.
- Two pre-existing E2E expectations were updated to the already-committed whole-pound SYP units (500 payment input and SYP 1,341 loan total). No currency behavior changed in this work.

## Deployment and remaining limits

Migrations `20261113000000_performance_wallet_balances.sql`, `20261113000100_installment_summary.sql`, and `20261113000200_loan_overview.sql` were applied to the configured hosted Supabase database on 2026-11-04 following explicit user authorization. Migration history, the summary function, overview view, history index, security-invoker settings, and unchanged wallet/ledger fingerprints were verified. The separate loan-deletion migration was excluded.

Home remains above the 150 KB initial-JavaScript target. Activity retains loaded rows for scrolling back; memoized feed rendering and native content visibility defer offscreen work, rather than removing rows from the DOM. Loan event history is fetched in 30-row keyset pages; the complete loan summary catalogue is still read in 500-row batches to keep global totals correct. No real-user INP or hosted-database timings were measured.
