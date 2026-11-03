# Notes from the reference project

Reference: **Open Budget Tracker** by Daniel Awde, https://github.com/danielawde9/budget-tracker (MIT). Read on 2026-11-03 for inspiration only; no code, copy, branding or assets are copied into this project.

## What it is

A bilingual (EN/AR, RTL) household budget on Vite + React + Supabase, hosted on Cloudflare Workers. Envelope model ("every dollar has one job"): USD/LBP wallets, plan groups by % of income, "Ready to assign", fund/move, loans, bills, investments, household spaces with invitations, an append-only ledger enforced by `SECURITY DEFINER` Postgres functions, plus an MCP connector for AI assistants.

## Borrow (good ideas)

- **Money as integer minor units** end to end (USD cents, LBP whole lira); a single money module for parse/format; Arabic-Indic digit parsing.
- **Never combine currencies.** Totals per currency; conversions only as labelled "≈" hints.
- **`<bdi>` around names and amounts**; amounts never mirror in RTL.
- **Logical CSS only**, so RTL is free.
- **A test that asserts no horizontal overflow** on every route at phone width in both languages. We adopt this as a Playwright helper.
- **Record from anywhere**, and recording from a budget item pre-fills it.
- **Bottom tab bar with a centred Add button** on mobile, a rail on desktop.
- **"I have this money / I owe this money"** choice instead of a negative-sign checkbox (from their owner feedback).
- PWA manifest **shortcuts** for "Add expense" / "Add income".
- Skeleton loading states, no plain "Loading…" text; smooth row insertion.

## Avoid (lessons from their own owner walkthrough, `docs/feedback/2026-10-03-owner-walkthrough.md`)

- **"Very overwhelming, I don't know how to navigate it."** Home showed the equation, wallets, net worth, alerts and bills at once. → Our Home leads with one answer ("left to spend") and folds the rest.
- **Eight record kinds** (Expense, Income, Transfer, Move money, Exchange, Invest, Loan, Refund). → We ship three modes: Expense · Income · Move.
- **Jargon**: Ready to assign, Fund, Set aside, Funded/Spent/Available. → Plain words; no envelope model in v1.
- **Transfer vs Move money confusion.** → One "Move" mode; a different-currency destination makes it an exchange.
- **Wide multi-group "Edit plan" dialog** was "the worst screen". → Budgets are edited as one simple list in a sheet; no nested groups.
- **Hash router** (`#/plan`). → Real App Router URLs; details deep-linkable.
- **One 100 KB global stylesheet** of `cr-*` classes. → Tokens + Tailwind + a small set of owned components.
- **Immutable ledger with reversal-only corrections**: correct for accounting, heavy for a personal tracker. → Editable transactions with soft delete + Undo.

## Scale contrast

Their app is a large, mature system (dozens of specs, 18 migrations, MCP server). Ours deliberately starts as a small, fast personal tracker and can grow toward their features (loans, recurring bills, households) later, if it earns them.
