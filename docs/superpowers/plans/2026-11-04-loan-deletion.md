# Loan deletion implementation plan

**Goal:** Permanently delete an archived loan and all linked transactions, reversing wallet effects; permanently delete any individual repayment.

**Architecture:** Narrow, authenticated database RPCs lock the parent loan and enforce ownership and revision checks. Existing balance and reporting views reflect removed transactions. Preserve the existing settled-only archive rule and latest-payment void/restore behavior.

**Tech stack:** Next.js, next-intl, Supabase/PostgreSQL, Vitest, pgTAP.

**Approved behavior:** User explicitly approved deleting all linked transactions and reversing wallet effects. Individual payment deletion removes that payment's original principal/fee allocation; other recorded payments retain their original allocations. Deleting a payment reopens an archived loan if necessary.

## Tasks

- [x] Add regression tests for action validation, confirmations, archived-only loan deletion, arbitrary repayment deletion, tenant boundaries, revision conflicts, and wallet/reporting effects.
- [x] Add a migration with narrowly scoped security-definer deletion RPCs; retain RLS restrictions on direct deletes and existing integrity triggers.
- [x] Add server actions and English/Arabic confirmations in loan details. Close details after successful deletion; reopening loads fresh history following action revalidation.
- [x] Run focused unit/UI tests, database tests in a disposable local database, typecheck, and lint. Do not commit or push.

## Implementation rulings

- Close loan details after either permanent deletion so paginated history cannot retain deleted rows. Reopening uses revalidated loan props and loads fresh history.
- Preserve only private user/request UUID markers after hard deletion. Review identified that response-lost forms could otherwise recreate deleted wallet movements. Insert guards and deletion functions share request advisory locks; markers contain no loan or payment financial data.

## Verification

- 36 focused loan unit/UI tests passed, including English/Arabic deletion confirmations.
- 155 pgTAP assertions passed in a disposable PostgreSQL 17 database (38 deletion assertions, 90 existing loan assertions, 27 repayment-plan assertions).
- 20 existing English/Arabic loan browser tests passed in the desktop project.
- Typecheck, targeted ESLint, and git diff whitespace checks passed.
- Fresh-context review identified the retired-request issue; it was fixed and re-reviewed with no remaining material findings.
- Migration applied to the app's configured hosted Supabase project on 2026-11-04 after explicit user authorization. Migration-history SQL matches the local source; authenticated execution and anonymous denial verified for both deletion RPCs.
