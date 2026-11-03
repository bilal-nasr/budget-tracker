# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Mobile web first, installable as a PWA. The phone is the primary device; tablet and desktop are supported layouts, not the design target.

## Stack

Next.js (App Router) + Supabase — chosen by the owner.
Hosting: self-hosted on the owner's own site (owner's decision). The app must not depend on any one platform: Next.js `output: "standalone"` (Node server or Docker image), optional `basePath` if served under a sub-path. Supabase is the hosted backend (Auth + Postgres).

Delegated details (chosen by Claude, owner may override): TypeScript, Tailwind CSS v4, shadcn/ui primitives, `next-intl` for EN/AR, `@supabase/ssr` for auth cookies. See `docs/ARCHITECTURE.md`.

## Users

One primary user: the owner (Bilal), tracking personal money day to day, mostly on a phone, often right after paying for something (in a shop, a taxi, at a counter). The job is "log this in a few seconds, then later see where my month is going." Money is held in both US dollars and Lebanese lira.

Exactly one account in v1: the owner. There is no public sign-up page; the owner's account is created once in Supabase and sign-ups are disabled. Data is still keyed by `user_id` with Row Level Security, so more accounts (or sharing) can be added later without a rewrite.

## Product Purpose

A personal budget tracker that makes logging income and expenses fast on a phone and shows, per month, how much was spent per category against a simple monthly limit, separately for USD and LBP.

Success means:
- Logging an expense takes under 10 seconds from opening the app.
- The home screen answers "how am I doing this month?" without scrolling or explanation.
- The owner keeps using it daily because it never feels like work.

## Positioning

A calm, fast, bilingual (English/Arabic) tracker built for a dual-currency life: every wallet holds one currency (USD or LBP), totals are never silently mixed, and an optional reference rate gives clearly-labelled "≈" equivalents. Simpler than envelope budgeting apps (YNAB-style "give every dollar a job"); deliberately so.

## Operating Context

- Logged on the go, one-handed, often outdoors or in a hurry; short sessions.
- Reviewed in longer sessions at month end (what did I spend, where).
- Lebanese context: cash is common, USD and LBP are used side by side, exchange happens at shops and money changers, no bank aggregation exists, so manual entry must be fast.
- Reference project (friend's app, read-only inspiration): https://github.com/danielawde9/budget-tracker — see `docs/REFERENCE-NOTES.md` for what to borrow and what to avoid.

## Capabilities and Constraints

v1 scope:
- Wallets (cash, bank, card), each in exactly one currency: USD or LBP. Opening balance; derived current balance.
- Transactions: expense, income, transfer between same-currency wallets, exchange between a USD and an LBP wallet (two amounts, one event).
- Categories (income/expense), seeded with bilingual defaults, editable, optional one level of subcategory.
- Monthly budgets: a limit per expense category per currency; carry forward to the next month by default.
- Home: this month's spending vs budget, per currency; recent activity.
- Reports: spending by category and month-over-month trend.
- English and Arabic with full RTL; light and dark theme.
- Installable PWA with an "Add expense" shortcut.

Constraints:
- Money is stored as integer minor units (USD cents, LBP whole lira). Never floats. Never add USD to LBP.
- All data is private to its owner; Row Level Security on every table.
- Single account: Supabase sign-ups disabled, plus an `OWNER_EMAIL` allowlist checked on sign-in and in the request proxy. No sign-up, invite, or account-management UI in v1.
- Every user-visible string ships in English and Arabic in the same change.

Explicitly out of v1 (candidates for later): more accounts / public sign-up, household/shared spaces, envelope "ready to assign" model, loans, recurring bills, savings goals, CSV import/export, bank sync, AI entry.

Open decisions:
- Arabic-Indic digits (٠١٢) vs Latin digits in Arabic UI — default Latin, setting to switch (to confirm).
- Custom in-sheet numeric keypad vs native keyboard for amount entry — to settle during design mockups.

## Brand Commitments

None yet. Product name is undecided (working name: "Budget Tracker"). No logo or palette exists; the visual direction is created in Phase 1 and recorded in `DESIGN.md`.

## Evidence on Hand

No real user data, testimonials, or assets. Do not fabricate any. Demo/seed data must be clearly synthetic.

## Product Principles

1. **Ten-second logging.** The add flow is the product. Every screen has a way to it within one tap.
2. **One question per screen.** Each screen leads with one answer (e.g. "left to spend this month") and reveals detail on request — the reference app's main failure was showing everything at once.
3. **Currencies stay honest.** USD and LBP are always shown separately; conversions are optional, labelled approximations.
4. **Plain words.** "Spent", "Left", "Budget", "Move money" — no accounting or envelope jargon.
5. **Phone first, always.** A feature is not done until it works at 360px wide, one-handed, in Arabic.

## Accessibility & Inclusion

- WCAG 2.2 AA target: contrast, 44×44px touch targets, visible focus, labels on every control.
- Full RTL support; numbers and amounts never mirror.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.
- State is never conveyed by color alone (over-budget has an icon and text).
