# Budget Tracker

A personal, mobile-first budget tracker: log expenses in seconds, set monthly limits per category, and see where the month is going, in **US dollars and Lebanese lira**, in **English and Arabic**.

Built with Next.js (App Router) and Supabase. Open sign-up with email verification, self-hosted, installable as a PWA.

> Status: in development. Phases 0 to 3 are built: sign-in, app shell, wallets, transactions, activity and a fixed monthly salary with a "Got salary" button. Budgets, transfers/exchange and reports are next. See [docs/PLAN.md](docs/PLAN.md).

## Features so far

- Wallets in USD or LBP (cash, bank, card). Totals are always per currency, never combined.
- Add an expense or income in a few taps with an in-sheet keypad; edit, duplicate, delete with Undo.
- Activity with day groups, search, filters and paging.
- Monthly salary: set the amount and wallet once, then press **Got salary**.
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
