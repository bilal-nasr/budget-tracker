# Loan monthly payments

Optional monthly amount and inclusive number of payments (1 to 1200). Calculate the final payment from the original total including the one-time fee, minus monthly amount times (count minus 1), using exact integer math. Example: 2000 total, 285 monthly, 7 payments gives 290 final. Both fields required together; blank both removes the plan. Final must be positive. Partial/extra payments remain manual, capped at actual debt. No automatic debits.

1. Add exact calculations, strict schemas, DTO decoding and tests.
2. Add an append-only migration for nullable monthly/count metadata, preserving RLS, immutable terms, request replay and ledger integrity. Test locally only.
3. Add editable monthly/count fields, calculated final preview, detail summary and payment suggestions; translate EN/AR and preserve uncertain-submission freezing.
4. Run unit/component, typecheck, lint, build and local SQL checks; review the financial and UI changes. Leave uncommitted; no production migration.

## Release follow-up — 2026-11-04

The owner subsequently authorized the production migration and code release. A separate application/schema backup was completed before applying `20261112000000_loan_repayment_plan.sql`. The production migration history is up to date, both plan columns are exposed by `loan_progress`, and fingerprints for nine financial datasets (including original loan fields and wallet balances) matched before and after migration.

Validation: 489 unit/component tests, 503 local PostgreSQL 17 assertions, 52 English/Arabic iPhone and desktop browser checks, lint, typecheck and production build passed. Financial and frontend reviews found no material blockers. The release check also exposed a category rollback test race; its assertion now waits for the optimistic transition to finish, as the neighboring restore test already does.
