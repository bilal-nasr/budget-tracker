# Owner feedback round 3: coordination

Requested on 2026-11-04. Each of the eight items has its own local Codex chat. The owner subsequently approved implementation of all plans and explicitly requested a final commit and push. Earlier planning-only and no-commit text in individual plans records the previous phase; the latest owner authorization supersedes it. Only the orchestrator performs the final combined commit/push after integration and verification.

## Implementation run

- Branch: `codex/round-3-features`, based on `dbb9d1d` (initially equal to `origin/main`).
- Baseline: 9 Vitest files / 46 tests passed before implementation.
- All eight chats dispatched to implementation. Auth and numeric input fixes have initial full leases. Other chats implement isolated new domain modules, tests, UI modules and reserved migrations first; shared integration is released in dependency order.
- Shared integration order: category lifecycle, SYP/Move UX, expense breakdowns, cashier settlement, salary cycles, loans. Numeric normalization finishes before currency integration. Only one shared-form/translation integration lease at a time.
- Migration reservations: `20261111000000_category_management`, `20261111000100_syp_currency`, `20261111000200_syp_currency_support`, `20261111000300_expense_breakdowns`, `20261111000400_cashier_settlement`, `20261111000500_installment_salary_cycles`, `20261111000600_loan_kind`, `20261111000700_loans`.
- New UI uses the existing design. Routine plan defaults are selected as described below; unavailable physical-iPhone/hosted-session verification is reported separately from automated evidence.
- No production database or hosted settings are changed by the implementation run. SQL verification uses a disposable local database.

## Sessions and deliverables

| Owner item | Plan | Status | Local chat ID |
| --- | --- | --- | --- |
| 1 | [category management](./01-category-management.md) | Implemented; live CRUD/archive/restore verified | `01a1a6d1-ecd9-7d80-ae57-e168994c34f2` |
| 2 | [expense breakdowns](./02-expense-breakdowns.md) | Implemented; atomic/replay and live save/reload verified | `01a1a6d1-ef2e-7d21-b9b9-71956f8bc486` |
| 3 | [30-day login persistence](./03-login-persistence.md) | Implemented; real browser restart/sign-out verified | `01a1a6d1-f1b2-7cc2-a7e1-a1e47ee60fb0` |
| 4 | [cashier payments and change](./04-cashier-payments-and-change.md) | Implemented; live cross-currency wallet effects verified | `01a1a6d1-f44c-7fe3-8b76-485e2453635a` |
| 5 | [installment salary cycles](./05-installment-salary-cycles.md) | Implemented; receipt/override races verified | `01a1a6d1-f6fe-7a51-9943-d6d45dca4f32` |
| 6 | [Syrian pound currency](./06-syrian-pound-currency.md) | Implemented, including the additional Move UX | `01a1a6d1-fa1f-7ae0-8186-fcebd517fe9e` |
| 7 | [loans with percentage fees](./07-loans-with-percentage-fees.md) | Implemented; live borrowed/lent repayments and fee reporting verified | `01a1a6d1-fd14-70c1-a086-af075deb92a6` |
| 8 | [Arabic numeric deletion fix](./08-arabic-numeric-deletion.md) | Implemented; browser editing tests, physical device pending | `01a1a6d1-ffde-7413-bb5a-aac7402221b5` |

### Additional Move UX request

Implemented by the existing currency/Move chat (item 6): cross-currency **You received** starts locked, with an adjacent edit icon that enables manual entry. Compact wallet dropdowns have clear localized **FROM** and **TO** labels. Manual-only SYP entry requires explicit unlock when no calculated rate exists; unsupported conversions are never inferred. This applies to wallet-to-wallet Move independently of cashier settlement.

All chats share the existing checkout, with serialized leases for shared forms, actions and translations. Each owns its feature and plan; the orchestrator owns this index, integration verification and the final commit/push. The implementation uses the defaults recorded below under the owner's subsequent instruction to implement all plans.

## Coordination constraints

- Keep expense itemization and cashier settlement separate: children explain the purchase cost; tender and returned change explain wallet movements. An expense is counted once.
- Preserve history when categories are deleted/archived. Dependent selectors, salary fallback and saved category references must remain valid.
- Generalize or explicitly guard the USD/LBP conversion contract before enabling SYP in transfers or cashier change. Never apply the existing two-currency formula to SYP silently.
- Installment status follows actual salary receipt cycles under item 5; receiving salary never resets the loan principal or creates another installment payment.
- Preserve exact integer money, per-currency summaries, tenant isolation, atomic multirow writes, bilingual strings, mobile UX and demo mode.
- Keep access tokens short-lived for item 3; persistence depends on refresh cookies and session policy, not a 30-day access JWT.
- Investigate numeric deletion before changing alignment. Browser automation cannot prove real iOS/Android keyboard behavior.
- New schema changes use append-only migrations after the latest existing migration. Reserve exact numbers only when implementation order is settled; the old round-2 index contains stale next-number guidance.

## Recommended implementation order

1. Numeric deletion and auth persistence: independent foundations; both need evidence before selecting a fix.
2. Category management and SYP: shared data/UI foundations.
3. Expense breakdowns, after category behavior is settled.
4. Cashier payments/change, after currency/rate and expense-breakdown contracts are settled.
5. Installment salary cycles, after currency changes to shared summaries land.
6. Loans with percentage fees, after fee allocation defaults are settled and the shared transaction/currency foundations are integrated. Both borrowing and lending are already confirmed; loans use separate records rather than treating principal as installment spending.

This is dependency ordering, not a requirement to implement all items in one batch. Any future implementation must serialize overlapping edits to money utilities, transaction actions/SQL, shared providers, translations and generated database types.

## Review and verification

### Proposed behavior to review

| Item | Recommended behavior |
| --- | --- |
| Categories | Add/edit user-owned expense and income categories. Delete unused categories; archive those with financial history. Reassign fixed/installment templates first. Keep archived labels and budgets readable; budgets continue until explicitly cleared. |
| Expense breakdowns | Optional one-level description/amount items. The $50 Sister expense remains one $50 debit. $20 + $30 fully itemizes it; a partial list shows the unitemized remainder. Parent category alone drives spending. |
| Login | Repair refreshed-cookie propagation and configure a native 720-hour session from sign-in, retaining short-lived access tokens. Confirm the deployed Auth backend supports the session setting; local config alone does not configure hosted Auth. |
| Cashier | Record purchase cost separately from tender and returned change, saving all wallet effects together. Require an active owned wallet for change currency. Use a confirmed rate snapshot for cross-currency reconciliation; preserve actual cash amounts. |
| Installments | Actual salary receipts define cycles. One payment changes the ordinary Pay action to status/Pay again; an explicit repeat action permits another payment. Salary receipt never resets debt. Partial payments still show their unpaid target. |
| SYP | Add SYP everywhere through one registry. Proposed precision is 100 qirsh per pound, explicitly current/new denomination; never rescale existing USD/LBP. SYP Move uses two actual amounts; legacy rate conversion remains USD/LBP-only. |
| Loans | Both borrowed and lent, with one additive percentage fee and principal-first repayments as proposed defaults. Principal moves wallets without counting as income/spending; only fee portions enter reports. Explicit existing-loan entry creates no cash movement. |
| iPhone deletion | Reproduce cross-field native Backspace/caret failure on iPhone in Arabic, patch the evidenced shared cause, and verify on a physical keyboard. Separately correct the confirmed Arabic-digit filtering in due-day inputs. |

### Shared implementation contracts selected by the orchestrator

- Item 2 establishes `transactions.revision` and one `save_transaction` RPC for parent/items. Item 4 extends that RPC with optional settlement data rather than creating `version`/`save_purchase` alternatives. Both return `{id, revision}` and use a stable UUID for retried creates, revision checks for edits, and version-aware delete/restore. Child edits return the final parent revision.
- Lifecycle actions require the exact captured revision; an expected+1 arithmetic shortcut does not prove an identical delete/restore retry. Unknown lifecycle outcomes require reconciliation. Salary/installment/transfer creators preserve their dedicated inputs but return the actual final revision for shared Undo. Salary-cycle RPCs acquire profile locks before installment/transaction locks.
- Create retries also require the immutable private receipt for their original final revision. Matching present-day values alone cannot authorize an old request after edit/revert or delete/restore. Unknown outcomes retain the exact request even when refreshed wallets or salary settings no longer permit a new payment; explicit Reload resolves revision conflicts.
- Missing item input preserves saved lines; an explicit empty list clears them. Sum of items is at most purchase cost; the remainder is computed. Cash tender never becomes the breakdown total.
- Item 6 owns currency registry/precision and the guarded existing USD/LBP converter. Item 4 owns any additional direct SYP rate snapshot/conversion needed for cashier change. Manual SYP transfers do not imply automatic SYP conversion support.
- Item 7 introduces the fee-only reporting projection; item 2 does not. It must preserve cashier purchase cost semantics and ordinary parent-only expense counting.
- Category hierarchy already exists in storage but is separate from expense itemization. No subcategory editor, descendant filter expansion or hierarchy redesign is assigned to item 2.
- Reconcile common SQL trigger definitions, wallet currency locks and lock order against the latest preceding migration. Never replace shared functions using an older plan's snapshot. Integrate loan-reference checks into category and wallet removal guards when loans land.

### Confirmed owner clarification

- Loans cover **both borrowing and lending**, with a **one-time percentage fee** (confirmed in the orchestrator chat on 2026-11-04). Recurring or compounding interest is outside this request.
- Numeric deletion affects **iPhone numeric inputs across fields** in Arabic. Native keyboard Backspace does not clear the number until the whole value is selected and deleted. The owner suspects cursor alignment; the plan must test touch caret placement and the shared input/sheet boundary rather than assume a due-day-only cause. iOS/browser/keyboard variants remain unverified.

### Selected defaults and deployment verification

- **SYP units:** proposed current/new denomination and two decimals must be explicit in the UI. Supporting old-denomination amounts would need an explicit unit model rather than a guessed conversion. Currency item 6 contains the authoritative references and date checked.
- **Cashier price currency:** proposal stores purchase cost in the paying wallet's currency. A separately entered shop price in another currency would need a price snapshot/valuation design. Enable cashier SYP pairs through item 4's direct-rate extension, or clearly disable them until that extension ships.
- **Loans:** additive fee, principal-first allocation and explicit existing-loan/no-wallet-movement entry are recommended. An upfront-withheld fee would change the cash movement and reporting contract.
- **Auth deployment:** verify effective hosted/self-hosted settings and native timebox availability. The proposed absolute 30-day policy is enforced on refresh, with an already-issued access token potentially valid for its remaining short lifetime. Source inspection has not proved the deployed logout cause.
- **iPhone evidence:** confirm browser/PWA, iOS and keyboard during reproduction. Desktop emulation cannot close native-keyboard validation. The confirmed due-day digit issue alone does not explain the reported cross-field Backspace failure.

The orchestrator reconciled category/itemization semantics, partial-item sums, shared save/revision/Undo contracts, SYP rate ownership, salary result revisions and loan reporting ownership. Both owner clarifications and the additional Move request are included. Historical planning checklists remain in each plan; their implementation records and the final integrated verification below describe the delivered state.

## Integrated verification — 2026-11-04

All eight features and the additional Move UX request are implemented on `codex/round-3-features`. Final checks:

- `pnpm typecheck`, `pnpm lint`, `pnpm build`, and Git whitespace checks passed.
- Vitest: **55 files, 475 tests passed**.
- Fresh PostgreSQL 17 migration replay and the actual disposable Supabase CLI database test lane: **10 suites, 476 assertions passed**. No hosted migration was applied.
- Concurrent writes: stable-ID expense creation/edit/remainder, all eight salary/installment scenarios, nine wallet-currency/reference orderings, and six authenticated loan API races passed.
- Demo Playwright: **700 cases passed across mobile-small, Android, iPhone/WebKit and desktop**. The initial full run passed 664; all 36 affected cases passed after updating fixture expectations, adding explicit sheet title associations and preventing development-only Next.js chrome from intercepting the loan link. Eight real-auth cases are intentionally skipped in this demo lane.
- Dedicated configured Auth lane: **4/4 passed** (EN/AR × Chromium/WebKit), including browser restart, authenticated routing, persistent cookies and sign-out followed by another restart. The local Auth service's native 720-hour timebox was verified separately.
- Configured local browser saves/reloads passed for category creation/rename/archive/restore, a two-item expense with cross-currency cashier change and verified wallet deltas, and borrowed/lent loans with full repayments and fee-only Activity totals.
- Captured and inspected 390px EN/AR light/dark screenshots; responsive checks include 320, 390, 430, 768 and 1280px. Captures and synthetic credentials stay outside Git in ignored task artifacts.
- Independent SQL and frontend reviews found material edge cases in exact rounding, create replay generations, reference locking, atomic wallet deletion, archived receiver edits, conflict/unknown-outcome recovery and loan pagination. All findings were fixed, regression-tested and source-reviewed again; no material review blocker remains.

Deployment/device verification remains explicit: apply the included migrations through the normal production deployment process, configure hosted Auth's supported 720-hour session timebox, and test the native Arabic number keyboard on a physical iPhone. Desktop WebKit touch/caret automation does not prove physical-keyboard behavior. Production data, hosted settings and billing were untouched.
