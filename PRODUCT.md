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

Anyone can create an account with email and password; it works once they confirm the email. The owner is the primary user, but each account is private to its own person: data is keyed by `user_id` with Row Level Security, so accounts never see each other's money.

## Product Purpose

A personal budget tracker that makes logging income and expenses fast on a phone and shows, per month, how much was spent per category against a simple monthly limit, separately for USD, LBP and SYP.

Success means:
- Logging an expense takes under 10 seconds from opening the app.
- The home screen answers "how am I doing this month?" without scrolling or explanation.
- The owner keeps using it daily because it never feels like work.

## Positioning

A calm, fast, bilingual (English/Arabic) tracker built for life with multiple currencies: every wallet holds one currency (USD, LBP or SYP), totals are never silently mixed, and supported reference conversions are clearly labelled. Simpler than envelope budgeting apps (YNAB-style "give every dollar a job"); deliberately so.

## Operating Context

- Logged on the go, one-handed, often outdoors or in a hurry; short sessions.
- Reviewed in longer sessions at month end (what did I spend, where).
- Lebanese context: cash is common, USD and LBP are used side by side, exchange happens at shops and money changers, no bank aggregation exists, so manual entry must be fast.
- Reference project (friend's app, read-only inspiration): https://github.com/danielawde9/budget-tracker — see `docs/REFERENCE-NOTES.md` for what to borrow and what to avoid.

## Capabilities and Constraints

v1 scope:
- Wallets (cash, bank, card), each in exactly one currency: USD, LBP or SYP. Opening balance; derived current balance.
- Transactions: expense, income and transfers with actual sent/received amounts. Automatic Move calculations are restricted to USD/LBP; SYP exchanges use explicit actual amounts.
- Categories (income/expense), seeded with editable bilingual defaults. Archive used categories to retain history, delete unused ones, and reassign live templates before removal. Existing category hierarchy is protected; hierarchy editing/reordering remains future scope.
- Optional one-level expense items describe a parent payment without another debit or category allocation. An unitemized remainder is allowed.
- Optional cashier payment/change may denominate the purchase cost independently from the paying wallet. Spending uses the stated cost currency, while wallet balances debit the exact tender once and credit every actual returned amount to its selected wallet. One purchase may return multiple currencies; new entries record the amounts exactly without calculating or requesting an exchange rate.
- Installment paid status follows actual salary receipt cycles, with an explicit repeat-payment action. Principal progress remains lifetime progress.
- Borrowed and lent loans with one additive, one-time percentage fee, principal-first repayments, fee-only income/spending and an explicit existing-loan entry that does not move cash.
- Monthly budgets: a limit per expense category per currency; carry forward to the next month by default.
- Home: this month's spending vs budget, per currency; recent activity.
- Reports: spending by category and month-over-month trend.
- English and Arabic with full RTL; light and dark theme.
- Installable PWA with an "Add expense" shortcut.

Constraints:
- Money is stored as integer minor units (USD cents, LBP whole lira, SYP whole pounds). Never floats. Never add different currencies. No automatic old/new SYP redenomination.
- All data is private to its owner; Row Level Security on every table.
- Open sign-up with email verification and password recovery (Supabase Auth). No owner allowlist. Persistent login uses a 30-day absolute session policy where configured; hosted Auth must be configured separately (see `docs/ARCHITECTURE.md` §3).
- Every user-visible string ships in English and Arabic in the same change.

Explicitly out of v1 (candidates for later): household/shared spaces, envelope "ready to assign" model, recurring/compounding loan interest, automated recurring transactions, savings goals, CSV import/export, bank sync, AI entry.

Input conventions:
- Latin digits by default, with an Arabic-Indic display setting; numeric parsing accepts keyboard digit scripts independently of UI locale.
- Main Add uses an in-sheet keypad; other amount fields use native text inputs with numeric/decimal keyboard hints, LTR editing and native caret selection.

## Brand Commitments

None yet. Product name is undecided (working name: "Budget Tracker"). No logo or palette exists; the visual direction is created in Phase 1 and recorded in `DESIGN.md`.

## Evidence on Hand

No real user data, testimonials, or assets. Do not fabricate any. Demo/seed data must be clearly synthetic.

## Product Principles

1. **Ten-second logging.** The add flow is the product. Every screen has a way to it within one tap.
2. **One question per screen.** Each screen leads with one answer (e.g. "left to spend this month") and reveals detail on request — the reference app's main failure was showing everything at once.
3. **Currencies stay honest.** USD, LBP and SYP are always shown separately; reference conversions never combine ledger totals.
4. **Plain words.** "Spent", "Left", "Budget", "Move money" — no accounting or envelope jargon.
5. **Phone first, always.** A feature is not done until it works at 360px wide, one-handed, in Arabic.

## Accessibility & Inclusion

- WCAG 2.2 AA target: contrast, 44×44px touch targets, visible focus, labels on every control.
- Full RTL support; numbers and amounts never mirror.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.
- State is never conveyed by color alone (over-budget has an icon and text).
