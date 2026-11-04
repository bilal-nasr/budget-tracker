# Budget Tracker

A personal, mobile-first budget tracker: log expenses, manage wallets and monthly limits, and track repayments in **USD, LBP and SYP**, in **English and Arabic**.

Built with Next.js (App Router) and Supabase. Open sign-up with email verification, self-hosted, installable as a PWA.

> Status: in development. The owner-feedback plans and integration details live in [round 3](docs/plans/round-3/README.md). Reports and other future scope remain in [docs/PLAN.md](docs/PLAN.md).

## Features so far

- Wallets in USD, LBP or SYP (cash, bank, card). Totals are always per currency, never combined. SYP uses the current/new pound, with 100 qirsh per pound; existing whole-lira LBP amounts keep their units.
- Add an expense or income in a few taps with an in-sheet keypad; edit, duplicate, delete with Undo.
- Manage expense/income categories in Settings. Used categories are archived with history retained; unused categories can be deleted. Templates need reassignment before their category is removed.
- Optional expense breakdowns describe one payment without adding extra wallet debits. Partial lists show the unitemized remainder.
- Move between wallets using compact FROM/TO dropdowns. Calculated received amounts are locked until the edit button enables manual entry; SYP exchanges use explicit actual amounts.
- Optional cashier tender/change records purchase cost once while applying the actual payment and returned change to their wallets. A different-currency return requires an active wallet in that currency.
- Activity with day groups, search, filters and paging.
- Monthly salary: set the amount and wallet once, then press **Got salary**.
- Installment progress follows actual salary receipts, with an explicit **Pay again** action for another payment in the same cycle.
- Borrowed and lent loans with a one-time percentage fee, partial repayments and separate principal/fee tracking. Existing loans can be recorded without moving cash again.
- Per-currency monthly budgets, fixed expenses and payment summaries.
- English and Arabic (RTL), light and dark, installable-ready, built phone-first.
- Email sign-up with verification; Row Level Security on every table keeps accounts apart.

Without Supabase keys the app shows synthetic demo data (read-only) so you can look around.

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
