# Budget Tracker

A personal, mobile-first budget tracker: log expenses, manage wallets and monthly limits, and track repayments with a **global currency catalog**, in **English and Arabic**.

Built with Next.js (App Router) and Supabase. Open sign-up with email verification, self-hosted, installable as a PWA.

> Status: in development. The owner-feedback plans and integration details live in [round 3](docs/plans/round-3/README.md). Reports and other future scope remain in [docs/PLAN.md](docs/PLAN.md).

## Features so far

- Every cash, bank or card wallet owns an exact balance for every enabled global currency. USD, LBP and SYP are seeded definitions; custom codes support 0–8 decimal places. Totals stay per currency, never combined.
- Add an expense or income in a few taps with an in-sheet keypad; edit, duplicate, delete with Undo.
- Manage expense/income categories in Settings. Used categories are archived with history retained; unused categories can be deleted. Templates need reassignment before their category is removed.
- Optional expense breakdowns describe one payment without adding extra wallet debits. Partial lists show the unitemized remainder.
- Move between different wallets; Exchange between different currency balances in the same wallet. Choose the exact source/destination currency. Cross-currency moves record actual sent/received amounts; only USD/LBP offers the explicit profile reference quote.
- Optional cashier tender/change keeps purchase cost separate from the cash handed over. The purchase may use a different currency from the paying wallet—for example, `LBP 340,000` cost, `$5` paid, and `LBP 110,000` returned. Add any number of actual returned amounts and choose a receiving wallet for each one. The app records those facts exactly and does not calculate an exchange rate.
- Activity with day groups, search, filters and paging.
- Monthly salary: set the amount and exact wallet/currency balance once, then press **Got salary**.
- Pending freelance payments from **Wallets → Pending payments**: track client/project totals and due dates, record partial receipts, and see the remaining amount by currency. Only received money enters wallets and income; receipt edits/deletion in Activity update the amount still owed.
- Installment progress follows actual salary receipts, with an explicit **Pay again** action for another payment in the same cycle.
- Borrowed and lent loans with a one-time percentage fee, partial repayments and separate principal/fee tracking. Existing loans can be recorded without moving cash again.
- Per-currency monthly budgets, fixed expenses and payment summaries.
- English and Arabic (RTL), light and dark, installable-ready, built phone-first.
- Email sign-up with verification; Row Level Security on every table keeps accounts apart.

When upgrading an existing database to whole-pound SYP, stop app writes and apply `20261112000100_syp_whole_pounds.sql` before starting the updated app. The migration divides existing SYP qirsh amounts by 100, including historical transfers, loan replay payloads and archived records. Any fractional-pound amount aborts the entire migration without rounding; resolve it explicitly before retrying. Direct exchange-rate quotes remain in major currency units.

Without Supabase keys the app shows synthetic demo data (read-only) so you can look around.

For pending payments on an existing database, apply `supabase/migrations/20261115000000_pending_payments.sql` after the preceding migrations. The feature requires its tables, ledger links and atomic receipt functions; deploying app code alone does not update Supabase. Database checks can run with `node scripts/test-pending-payments.mjs` against the disposable container documented at the top of that script.

## Docs

- [PRODUCT.md](PRODUCT.md): what we're building and why
- [docs/MOBILE-UX.md](docs/MOBILE-UX.md): mobile design & responsiveness spec
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): stack, data model, auth, money, i18n
- [docs/PLAN.md](docs/PLAN.md): phased build plan
- [docs/REFERENCE-NOTES.md](docs/REFERENCE-NOTES.md): lessons from the reference app
- [CLAUDE.md](CLAUDE.md): rules for AI-assisted work in this repo

## Getting started (after Phase 0)

Requires Node 22+ and pnpm. A Supabase project is needed for real data (Docker and the Supabase CLI only for a local stack).

```bash
pnpm install
cp .env.example .env.local      # fill in Supabase URL/keys and NEXT_PUBLIC_SITE_URL
pnpm db:start                   # local Supabase
pnpm db:reset                   # migrations + synthetic seed
pnpm owner:create               # optional: creates a confirmed account without email (needs OWNER_EMAIL)
pnpm dev
```

## Deploying to your own site

```bash
pnpm build                      # .next/standalone
node .next/standalone/server.js # or build the Docker image
```

Serve it over HTTPS. Set `NEXT_PUBLIC_BASE_PATH` if it lives under a sub-path (e.g. `/budget`). Point it at a hosted Supabase project with sign-ups enabled, email confirmations on, the Site URL and redirect URL (`https://<domain>/auth/confirm`) set, the bilingual template from `supabase/templates/confirmation.html`, and a custom SMTP provider (the built-in mailer only reaches your own team).

### Login persistence

The local Auth configuration uses a 720-hour (30-day) absolute session lifetime from sign-in, with one-hour access tokens and rotating refresh tokens. Browser restarts retain a valid session. Supabase checks the lifetime on refresh, so an issued access token can remain valid for its remaining hour after the boundary.

For hosted Supabase, configure the equivalent **720-hour time-boxed session** in the project's Auth settings; this feature requires a supported Pro or higher plan. Leave any shorter inactivity timeout and single-session enforcement disabled. The local `supabase/config.toml` does not change hosted settings. For a separately self-hosted Supabase Auth service, configure `GOTRUE_SESSIONS_TIMEBOX=720h` on that service. Signing out, revocation, or clearing browser storage can end a session earlier.

Real-session browser checks use `playwright.auth.config.ts` with a disposable configured app and synthetic account; the normal E2E suite uses read-only demo data.

## Global currencies and wallet lifecycle

Add currencies in Settings → Currencies. Adding or re-enabling a currency gives every nondeleted wallet, including recovery-only Needs-attention wallets, a durable balance row. Existing IDs and amounts survive. New wallets receive every enabled currency, with their opening amount only in the selected default. The Wallets Currency view shows one currency across the shared wallet order; changing that view does not change wallet defaults.

The catalog orders by creation timestamp and code. Wallet reorder is shared by every currency and picker, with pointer and keyboard controls. Disable checks nonzero amounts and active dependencies, switches affected defaults to the next eligible catalog currency, and keeps history readable. Re-enable retains balance IDs; only a never-used currency can be deleted. Wallet deletion settles every positive or negative nonzero balance to an explicit same-currency counterpart atomically, then retains historical references and names. Ordinary actions exclude disabled currencies, deleted wallets and Needs-attention wallets.

Money helpers require runtime definitions. Integer minor units are exact within the supported range; formatting, parsing, reports and exports use configured precision, including BTC's eight places. There is no combined cross-currency total or implicit conversion.

For the optional authenticated integration test, provision a confirmed synthetic `@example.test` owner on an explicitly disposable loopback Supabase stack. Set `BUDGET_LIFECYCLE_AUTH_FILE` to an ignored JSON fixture with `url`, `key`, `accessToken` and `refreshToken`, then run `pnpm exec playwright test --config=playwright.lifecycle.config.ts`. The default `pnpm test:e2e` suite intentionally uses blank credentials and read-only preview data. Never use cloud or personal credentials for these tests; purge the temporary auth file afterward.

### Monetary intent and retry boundaries

Apply `20261127000000_money_intent_boundaries.sql` together with this application version. Each typed money/configuration request carries only its parsed currencies as `expectedUnits: {CODE: decimalPlaces}`. Server Actions transmit this bounded map in the same database request's `x-budget-units` header. The database validates ownership and the current code/precision under the owner/catalog locks, even after first use; symbols are presentation only. Missing or stale caller intent conflicts, refreshes the form and requires re-entry. Automatic zero balances remain use-neutral. Only genuinely server-generated fixed/salary amounts on their exact persisted balances may omit the map; a supplied map is always checked.

Move/Exchange uses a stable request UUID and an immutable payload, including units. An exact retry returns the original transaction and revision; changing that token's payload conflicts. Wallet deletion sends every balance's confirmed signed amount, code and precision, including zeros, and checks the complete plan and dependencies before any settlement. Successful receipts replay before current tombstone restrictions. Direct integrations must use the UUID transfer overload and supply denomination intent; the old non-idempotent transfer entry points are internal-only.

Currency-disable inspection follows owner-scoped keyset pages and rejects incomplete joins. Historical cashier change facts include the original receiver wallet name alongside its exact balance ID, currency and minor amount; that read-only snapshot is retained by the export and excluded from mutation input.
