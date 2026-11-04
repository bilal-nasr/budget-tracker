# Pending Payments Implementation Plan

> Execute inline using superpowers:executing-plans. Do not commit.

**Goal:** Track freelance receivables with partial receipts that become income only when received.
**Architecture:** Pending-payment table, linked income transactions, atomic receipt RPC, derived progress view; Server Actions and a bilingual page using incumbent components.
**Tech Stack:** Existing Next.js, Supabase/Postgres, Zod, next-intl, Vitest, Playwright.
**Spec:** ../specs/2026-11-04-pending-payments-design.md

## Global constraints

Integer minor units, separate currencies, RLS, owned active wallets/categories, stable retry IDs, existing revision/Undo contracts, EN/AR and mobile RTL. Preserve existing working changes. No commits.

## Review focus

Concurrent overpayment; uncertain retry after a ledger edit; foreign owner/currency; restore after another receipt fills the job; archived categories and missing wallets.

## Tasks

- [x] Add schema/date/amount validation and tests in src/features/pending-payments.
- [x] Add migration and SQL tests for ownership, idempotence, partial receipts, overpayment, edit/delete/restore and reporting.
- [x] Add queries and validated actions; test action boundaries.
- [x] Add bilingual list, create/edit/receipt sheets, loading/error routes, and Wallets entry.
- [x] Run focused and regression tests, typecheck/lint, SQL where local runtime permits, and mobile EN/AR browser checks; document verification.

## Execution notes

Proceed is treated as authorization to implement the selected approach. Existing uncommitted loan/installment work is retained.

Ruling: reuse the existing generic `useLoanSubmission` hook for safe retained financial requests; its behavior is generic despite its historical name. No changes to loan behavior.

Review fixed two issues: paginate both reads past PostgREST limits, and derive deletion eligibility from all receipt history, including soft-deleted receipts. Query regressions cover 1001 jobs/receipts; a second code review found no remaining material concerns.

Verification: `pnpm typecheck`, `pnpm lint`, `pnpm test` (511 tests), and `pnpm build` passed. `node scripts/test-pending-payments.mjs` passed 40 pgTAP assertions and a real concurrent receipt race against a disposable, network-isolated Postgres container. Eight Playwright flows passed across 320/390 mobile Chromium/WebKit and desktop, English and Arabic. Four final capture checks passed after disabling screenshot animations.

Visual evidence: `.impeccable/review/pending-payments/`. Existing DESIGN.md tokens, shared sheet/button/input components, numeric editing and RTL conventions were checked; no design-system changes or shipping raster assets. Independent Impeccable finish review: **ship**, all six required captures valid, no material fixes. Review calibrated against incumbent DESIGN.md; no separate QUALITY BAR card for this ordinary extension. Existing design-system files preserved.

Deployment: at the user's request, migration `20261115000000` was applied atomically to the configured Supabase project on 2026-11-04 and recorded in its migration history. The existing transaction ledger was verified unchanged and RLS enabled. Other environments still require this migration before serving real data. The user subsequently authorized committing and pushing all current changes.
