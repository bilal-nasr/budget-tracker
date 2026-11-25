# Architecture

How the app is built. Product scope lives in `PRODUCT.md`; mobile behaviour in `docs/MOBILE-UX.md`; the build order in `docs/PLAN.md`.

## 1. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js (latest stable), App Router, TypeScript strict, Turbopack | Owner's choice. Server Components keep the phone bundle small. |
| Styling | Tailwind CSS v4 + CSS variables for tokens | Logical-property utilities (`ms-*`, `ps-*`, `start-*`) make RTL cheap. |
| UI primitives | shadcn/ui (base-nova, on Base UI, RTL mode) | Accessible dialogs/sheets/menus we own and restyle. Bottom sheet = Base UI Drawer (swipe to dismiss built in). |
| Icons | `lucide-react` | Tree-shakeable, consistent stroke. |
| i18n | `next-intl` | Server + client messages, `[locale]` routing, ICU plurals, `dir` per locale. |
| Backend | Supabase: Postgres + Auth | Owner's choice. RLS for privacy; SQL views for totals. |
| Supabase client | `@supabase/ssr` | Cookie sessions that work in Server Components, Server Actions and the proxy. |
| Validation | `zod` | One schema per form, shared by client form and Server Action. |
| Forms | React 19 `useActionState` + `useOptimistic` | No form library needed for these small forms. |
| Charts | Recharts (via shadcn chart wrapper) | Good enough for donut + bars; SSR-safe with client islands. |
| Dates | `date-fns` + `@date-fns/tz` | Month boundaries in the owner's timezone (`Asia/Beirut`). |
| PWA | Web app manifest + `@serwist/next` service worker | Installable, offline shell, "Add expense" shortcut. |
| Tests | Vitest (unit), Playwright (e2e, mobile projects), pgTAP or SQL tests via Supabase CLI | See §9. |
| Package manager | pnpm | |

## 2. Hosting & environments

Self-hosted on the owner's site. Keep the app platform-neutral:

- `next.config.ts`: `output: "standalone"`; `basePath` from `NEXT_PUBLIC_BASE_PATH` (empty by default) in case it is served under a sub-path such as `/budget`.
- Ship a `Dockerfile` (multi-stage, `node:22-alpine`, runs `.next/standalone/server.js`) and a plain `pnpm build && node .next/standalone/server.js` path for non-Docker hosts.
- HTTPS is required (PWA install, secure cookies).
- Supabase: one hosted project for production; the local Supabase CLI stack (Docker) for development.

Environment variables (`.env.example` is committed, `.env.local` is not):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # sb_publishable_… (anon role)
SUPABASE_SECRET_KEY=                    # sb_secret_… — server only, used by seed/admin scripts, never in the app bundle
OWNER_EMAIL=                            # only for `pnpm owner:create`; not used for sign-in
NEXT_PUBLIC_BASE_PATH=                  # optional, e.g. /budget
NEXT_PUBLIC_SITE_URL=                   # e.g. https://example.com/budget
```

## 3. Authentication (open sign-up, email verification)

- Supabase Auth, **email + password**. Sign-ups are enabled and **email confirmations are required** (`[auth] enable_signup = true`, `[auth.email] enable_confirmations = true` locally; the same toggles in the hosted dashboard).
- Sign-up (`signUp` Server Action) always lands on `/[locale]/check-email`, whether or not the email already had an account, so the form never reveals who has an account. The confirmation email (bilingual template in `supabase/templates/confirmation.html`) links to the redirect URL we pass (`<site>/auth/confirm?next=/<locale>/onboarding`) with `&token_hash=...&type=email` appended, so it does not depend on the project's Site URL. In the Supabase dashboard set Site URL to the production address and add `https://<domain>/**` to the redirect allow-list; otherwise Supabase replaces our redirect URL with the Site URL (localhost by default).
- `/auth/confirm` (a Route Handler outside `[locale]`) verifies the token, which signs the person in, and redirects to `next`. `next` is untrusted: `safeNext` only honours same-site `/en` or `/ar` paths, otherwise `/en`.
- Signing in before confirming returns `email_not_confirmed`; the sign-in form says so and offers to resend the link. A wrong password and an unknown email give the same message.
- Accounts are isolated by RLS (`user_id = (select auth.uid())` on every table); `supabase/tests/isolation.test.sql` checks that one account cannot read or write another's data. A bootstrap trigger gives each new user a profile and starter categories. The one exception is the invoice folder tables (`invoice_folders`, `invoice_items`, `invoice_members` and their helpers): rows there are shared, so their policies check folder membership through `is_invoice_member(folder_id)` rather than `user_id = (select auth.uid())`. Do not copy that policy shape for per-person data, and do not flag these tables as missing the `user_id` rule.
- `proxy.ts` refreshes the session on every request (`getClaims`, verified locally) and redirects signed-out visitors to `/[locale]/sign-in`; sign-in, sign-up and check-email are public.
- Session refresh runs before locale middleware snapshots request headers. Every final rewrite/redirect preserves refreshed or deleted cookies and the SDK's cache-protection headers; confirmation/recovery redirects are private/no-store. Auth cookies persist across normal browser restarts. The local absolute session timebox is 720 hours, while access JWTs stay at 3600 seconds and refresh tokens rotate. Timebox/revocation take effect on refresh, with an already-issued JWT retaining its remaining lifetime. Hosted Auth needs its own supported 720-hour timebox setting (Pro+); local TOML never configures production Auth.
- Hosted setup needs a custom SMTP provider: Supabase's built-in mailer only sends to the project's own team members and is heavily rate-limited.
- Bot protection: set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to show a Cloudflare Turnstile check on sign-in and sign-up (the token also goes with "send the link again"). It only helps when captcha protection is also turned on in the Supabase dashboard (Authentication > Bot and Abuse Protection) with the Turnstile secret; also lower the email rate limit there. Without both, anyone can trigger confirmation emails to any address.
- Confirmation redirects use `NEXT_PUBLIC_SITE_URL` (not the request's own address, which is internal behind a proxy or in Docker).
- Password reset: `/[locale]/forgot-password` emails a link (always the same "link is on its way" answer, with the bot check); the link goes through `/auth/confirm` with `type=recovery`, which signs the person in and sends them to `/[locale]/reset-password` to choose a new password. Paste `supabase/templates/recovery.html` into Supabase (Authentication > Emails > Templates > Reset password).
- Not built yet: account deletion, a "change password" screen in Settings.
- Sign-in keys (passkeys): Settings > Sign-in keys adds, renames and removes keys, and the sign-in page has "Sign in with a sign-in key" (no email or password typed). The phone or password manager shows its own prompt (fingerprint, face, screen lock, or a QR code to a phone for a key held elsewhere), so this runs in the browser through Supabase Auth's native passkey API (`registerPasskey()` / `signInWithPasskey()`; code in `src/features/passkeys/`). The browser client stores the session in the same cookies the server reads. Passwords keep working next to keys; sign-up and recovery are unchanged. The secret half never leaves the device and there is no table of our own. Browsers only allow this on HTTPS or `localhost`.
- Sign-in keys setup: local `supabase/config.toml` enables `[auth.passkey]` and `[auth.webauthn]` for `localhost:3000`. Hosted Auth needs the same: passkeys enabled, `rp_id` = the site domain (no scheme or port), `rp_origins` = its full origins (for example `https://budget.example.com`), and `rp_display_name`. A key is tied to that domain, so changing the domain makes existing keys useless. With Turnstile on, the sign-in key button sends the same bot-check token. Not yet verified against a real phone or a hosted project.

## 4. Folder structure

```
src/
  app/
    [locale]/
      (auth)/sign-in/page.tsx
      (app)/
        layout.tsx            # AppShell: bottom tabs (mobile) / rail (tablet) / sidebar (desktop)
        page.tsx              # Home
        transactions/page.tsx
        transactions/[id]/page.tsx   # deep-linkable detail (also opened as a sheet via intercepting route)
        budgets/page.tsx
        wallets/page.tsx
        reports/page.tsx
        settings/page.tsx
        @sheet/(.)transactions/[id]/page.tsx   # intercepted detail sheet
      layout.tsx              # <html lang dir>, fonts, theme, NextIntlClientProvider
    manifest.ts               # PWA manifest (localised name per request)
    sw.ts                     # serwist service worker entry
  components/
    ui/                       # shadcn primitives (restyled to DESIGN.md tokens)
    shell/                    # BottomTabBar, SideRail, TopBar, AddButton
    add/                      # AddSheet, AmountPad, CategoryGrid, WalletPicker
    money/                    # Amount, CurrencyTotals, BudgetBar
  features/
    transactions/  { actions.ts, queries.ts, schema.ts, components/ }
    wallets/       { … }
    categories/    { … }
    budgets/       { … }
    reports/       { … }
  lib/
    supabase/ { server.ts, client.ts, proxy.ts }
    money.ts                  # minor-unit parse/format, never mixes currencies
    dates.ts                  # month ranges in owner timezone
    i18n/ { routing.ts, request.ts }
  messages/ { en.json, ar.json }
supabase/
  migrations/                 # SQL, the only source of schema truth
  seed.sql                    # synthetic demo data only
  tests/                      # SQL tests for RLS + views
e2e/                          # Playwright specs
```

Rules:
- Reads: Server Components call `features/*/queries.ts` (server-only Supabase client). No client-side fetching for page data.
- Writes: Server Actions in `features/*/actions.ts`, each validates with zod, relies on RLS (never the secret key), then `revalidatePath`/`updateTag`.
- Client components are islands: the add sheet, charts, month switcher, filters.

## 5. Data model

### Owner-feedback extensions

The append-only migrations are the authoritative implemented schema; the original phase sketch below includes future concepts. Current ledger kinds are `expense`, `income`, `transfer` and `loan` (an exchange is a transfer with two currencies).

- `src/lib/currency.ts` defines USD cents, whole-lira LBP and current/new SYP qirsh. `money.ts` is the public parse/format boundary. Exact products and rounding use BigInt; TypeScript targets ES2020, within the installed Next.js browser baseline.
- Category reads keep the full historical catalogue separate from active selection options. Removing a referenced category archives it; financial history is never reassigned or cascaded away. Archived budget limits remain until explicitly cleared.
- `expense_items` are descriptive children of one expense. Their total cannot exceed purchase cost, and they never enter wallet or spending aggregates independently.
- `transactions.revision` guards edits and lifecycle mutations. A draft UUID identifies retried creates; `save_transaction` atomically saves parent, items and optional settlement. Delete/restore require the exact captured revision.
- Cashier fields separate purchase cost from actual tender and an ordered collection of returned amounts. `transactions.currency` remains the payer-wallet currency; nullable `cost_currency` overrides it only for the purchase/reporting denomination. A differing cost currency requires a live ordinary-expense settlement. `transactions.balance_id` and `transactions.tender_minor` store the first tender line; owner-scoped `cashier_changes` child rows are the purchase's other cashier legs, each with its wallet balance, exact amount, currency and position. `cashier_changes.leg` is `change` (returned cash, a credit) or `tender` (an additional payment, a debit); change legs come first in position order. A purchase with one tender has no `tender` legs, so historical rows needed no rewrite. Aggregate saves lock affected wallets deterministically and replace the parent, expense items and all change rows atomically. Wallet projections debit the first tender once, debit every `tender` leg and credit every `change` leg, while `reporting_entries` emits `coalesce(cost_currency, currency)` and the stated purchase cost. `change_balance_ids` is a derived GIN-backed projection of every leg balance (change and additional tender) used by the Activity filter and the balance guards, never the canonical amount source. The settlement payload is `{tenderMinor, changes, extraTenders?}`; omitting `extraTenders` means one tender. Validation never converts: with every leg in the cost currency, paid minus returned must equal the cost; with some change in another currency it must exceed the cost; with some tender in another currency it must be below the cost; with other currencies on both sides nothing is compared. New and financially changed settlements do not calculate or save an exchange rate; migrated historical rate metadata remains readable on its original child row and survives only an otherwise unchanged metadata edit.
- Installment payments retain their salary receipt ID. Receipt cycles affect paid status, while lifetime principal and calendar-month expense reporting remain independent. Cycle-aware mutation paths lock profile, installment and transaction in that order.
- Loans use separate records and managed ledger events with principal/fee splits. `reporting_entries` includes ordinary income/expense and only loan fees; loan principal affects wallet balances without inflating spending or income.
- Invoice rows connect to the ledger only by being paid, the same way shopping items are bought. `payItems` records an ordinary expense through `createTransactionCore` (`save_transaction`, with the sheet's stable request id as the transaction id, one expense per currency), then `mark_invoice_items_paid` links the rows in one statement; a link that can no longer be made takes the expense back out with `deleteTransactionCore`. `invoice_items.paid_transaction_id` references the payer's transaction (`on delete set null`). Because a shared folder's people cannot read that transaction, the visible marker is denormalised onto the row (`paid_by`, `paid_on`, `paid_at`) and is never client-decided: `invoice_items_integrity` recomputes it from the expense on every write, and the `transactions_sync_invoice_paid` trigger re-touches the rows when the expense is deleted, restored or re-dated, so Undo in Activity un-marks them with no application hook. A paid row's name, price, quantity and currency are frozen; no wallet or amount of the payer is copied. Bulk delete, move and Undo are single-statement RPCs (`delete_invoice_items`, `move_invoice_items`, `restore_invoice_items`) under the caller's RLS.

All tables live in `public`, all have `user_id uuid not null default auth.uid() references auth.users`, and RLS policy `user_id = (select auth.uid())` for select/insert/update/delete. Amounts are `bigint` minor units with `check (amount_minor > 0)`; sign comes from `kind`, never from a negative number. (Invoice folder tables are the exception: shared rows, access by folder membership via `is_invoice_member`.)

```sql
create type currency as enum ('USD', 'LBP');            -- USD: 2 decimals (cents); LBP: 0 decimals
create type wallet_kind as enum ('cash', 'bank', 'card');
create type category_kind as enum ('expense', 'income');
create type txn_kind as enum ('expense', 'income', 'transfer', 'exchange');

profiles (
  user_id uuid primary key references auth.users on delete cascade,
  locale text not null default 'en' check (locale in ('en','ar')),
  digits text not null default 'latin' check (digits in ('latin','arabic')),
  timezone text not null default 'Asia/Beirut',
  theme text not null default 'system',
  default_wallet_id uuid,
  onboarded_at timestamptz
)

wallets (
  id uuid pk, user_id,
  name text not null (1..40),
  kind wallet_kind not null,
  currency currency not null,                 -- immutable after first transaction
  opening_balance_minor bigint not null default 0,   -- may be negative for cards
  icon text, color text,
  position int not null default 0,
  archived_at timestamptz,
  created_at timestamptz
)

categories (
  id uuid pk, user_id,
  parent_id uuid null references categories,  -- one level only (enforced by trigger)
  kind category_kind not null,
  name_en text, name_ar text,                 -- at least one required
  icon text not null, color text not null,
  position int, archived_at timestamptz
)

transactions (
  id uuid pk, user_id,
  kind txn_kind not null,
  occurred_on date not null,
  wallet_id uuid not null references wallets,         -- source (expense/transfer/exchange) or target (income)
  amount_minor bigint not null check (amount_minor > 0),
  currency currency not null,                          -- copied from wallet; trigger checks it matches
  category_id uuid null references categories,         -- required for expense/income, null otherwise
  to_wallet_id uuid null references wallets,           -- transfer/exchange only
  to_amount_minor bigint null,                         -- exchange only (the other currency)
  note text null (<= 140),
  created_at timestamptz, updated_at timestamptz,
  deleted_at timestamptz null                          -- soft delete → "Undo" for 7 days
)
-- constraints: transfer ⇒ same currency both wallets, to_amount null
--              exchange ⇒ different currencies, to_amount_minor > 0
-- index: (user_id, occurred_on desc, created_at desc) where deleted_at is null

budgets (
  id uuid pk, user_id,
  category_id uuid not null references categories,   -- expense categories only
  currency currency not null,
  month date not null check (month = date_trunc('month', month)),
  amount_minor bigint not null check (amount_minor >= 0),
  unique (user_id, category_id, currency, month)
)
-- "carry forward": reading month M with no rows uses the latest month < M (done in the view).

reference_rates (
  user_id, effective_on date, lbp_per_usd numeric(12,2) not null,
  primary key (user_id, effective_on)
)   -- only for "≈" hints; never used to add currencies together
```

Read models (SQL views with `security_invoker = true` so RLS applies):

- `wallet_balances`: opening + incomes − expenses ± transfers/exchanges, per wallet.
- `month_category_spend(month)`: function returning spent per (category, currency) for a month, plus the effective budget.
- `month_summary(month)`: per currency: income, expense, budgeted, left.

New-user bootstrap: an `after insert on auth.users` trigger creates `profiles` and the seeded bilingual default categories.

## 6. Money

- `lib/money.ts` is the parse/format boundary; `lib/currency.ts` owns currency metadata. USD and current/new SYP have 2 decimals, while LBP has 0. Exact rational calculations use BigInt in TypeScript and integer quotients in SQL.
- Supabase returns `bigint` as a JS number; safe because amounts are capped at 10^15 minor units (< 2^53). Arithmetic is integer-only on minor units.
- Parsing accepts Latin and Arabic-Indic digits, `,` / `٬` grouping, `.` / `٫` decimal.
- Formatting uses `Intl.NumberFormat` with the profile's digit setting (`ar-u-nu-latn` vs `ar-u-nu-arab`), always `tabular-nums`, always wrapped in `<bdi dir="ltr">` so it never mirrors.
- Totals are shown per currency. A "≈ $X" or "≈ LBP Y" hint appears only when a reference rate exists, and always with the ≈ sign.

## 7. i18n & RTL

- Routes are prefixed: `/en/...`, `/ar/...`; default comes from the profile, falling back to `Accept-Language`.
- `<html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>`.
- Tailwind logical utilities only (`ms-/me-/ps-/pe-/start-/end-/text-start`). Lint rule bans `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right`.
- Direction-bearing icons (chevrons, back arrows) flip with `rtl:-scale-x-100`; charts keep time flowing left→right in both locales.
- Category names come from `name_en`/`name_ar` with fallback to the other.
- All strings in `messages/en.json` and `messages/ar.json`; a test fails if a key exists in one file only.

## 8. Performance budget (mobile, mid-range Android, 4G)

- LCP < 2.0s, INP < 200ms, CLS < 0.05 on Home and Transactions.
- First-load JS for an app route < 150 KB gzip; charts are loaded only on Reports/Home islands.
- Fonts: `next/font`, subset Latin + Arabic, `display: swap`, max 2 families.
- Lists paginate by cursor (`occurred_on, created_at, id`), 30 rows per page, "Load more" plus infinite scroll.

## 9. Testing

- **Unit (Vitest):** `money.ts`, `dates.ts`, zod schemas, budget math.
- **Database (Supabase CLI + SQL tests):** RLS denies cross-user access; transfer/exchange constraints; balance and month-summary views.
- **E2E (Playwright):** projects `mobile-small` (320×568), `iphone` (390×844, WebKit), `android` (412×915, Chromium), `desktop` (1280×800). Each runs in `en` and `ar`. Shared assertions on every route: no horizontal overflow, main `h1` visible, bottom bar not covering content, axe has no serious violations.
- **Visual:** Playwright screenshots of key screens at 390px EN/AR, light/dark.

## 10. Claude connector (MCP)

An AI assistant such as Claude can read and change a signed-in person's budget data. Design: `docs/superpowers/specs/2026-11-24-mcp-connector-design.md` (§9 covers the hardening). Only apps the owner registered may connect. In the database a connected app may read, and may make only the writes the write tools make (an explicit list in the request guard); everything else is refused. 55 tools: 17 read, 38 write.

- **Endpoint:** `src/app/mcp/route.ts` serves `/mcp` (stateless Streamable HTTP, official MCP TypeScript SDK) outside `[locale]`, so `proxy.ts` never touches it. Its public address is `NEXT_PUBLIC_SITE_URL` plus `NEXT_PUBLIC_BASE_PATH` plus `/mcp` (`src/lib/mcp/public-url.ts`).
- **Identity:** the client sends `Authorization: Bearer <access token>`. The route verifies it with Supabase (`getClaims`, needs a `sub` and the `authenticated` role) and runs the tool inside a request context (`src/lib/supabase/request-context.ts`, an `AsyncLocalStorage` holding the token and user id). `createClient()` and `getUserId()` check that context first: inside it, `createClient()` returns a client that sends the token and has no cookie access, and `getUserId()` returns the verified id. Existing queries therefore run unchanged, as that user, under RLS. A bad or missing token gets a 401 and never falls back to cookies. If Supabase Auth cannot be reached or fails (a retryable fetch error or 5xx returned by `getClaims`, or an abort, timeout or failed fetch thrown out of it) the token check throws a plain error and the endpoint answers 500, so a client does not throw away a good token. A token too malformed to decode (for example `abc.def.ghi`) is still a 401 `invalid_token`. Code under `src/features` must not call `supabase.auth.getUser()` directly; use `getUserId()`.
- **Approved apps and sessions:** only apps in `public.connector_clients` are accepted. The table is written only with the secret key, by `pnpm connector:register "<name>"` (`scripts/register-connector-client.mjs`), which creates a public OAuth client (PKCE, no secret) with the redirect address `https://claude.ai/api/mcp/auth_callback`, records it and prints the app id. `connector_clients.client_id` must equal the lower-case uuid text of the OAuth client (that is what the token's `client_id` claim carries). Dynamic client registration is off (`allow_dynamic_registration = false` locally, the same switch in the hosted dashboard). `/mcp` (`src/lib/mcp/auth.ts`, `clients.ts`) accepts a token only if its `client_id` is registered and it carries a canonical `session_id`; the lookup reads `connector_clients` with the caller's own token, so it passes the database guard below. Only a positive answer is cached, for 60 s per app and session (at most 1000 entries). A token with no `client_id` (an ordinary sign-in session) is refused unless `MCP_ALLOW_SESSION_TOKENS=1`, which is for local testing only and stays unset in production. A refused token is a 401 `invalid_token`. If the lookup cannot be answered (network failure, timeout, 408, 429, 5xx) the endpoint answers 500 instead, so a client keeps a good token.
- **Tool kit** (`src/lib/mcp/`): each feature declares tools in `src/features/<feature>/mcp.ts` with `defineTool({ name, title, description, input, kind, run })`. Names are `<area>_<verb>`, descriptions are English and read by the model. `src/lib/mcp/registry.ts` collects them; `kind` is `read` (read-only hint), `write` (creates and edits) or `destructive` (deletes, voids, balance adjustment: the client is told to ask first). `run` calls the feature's existing query or Server Action, never the database directly. Errors the model may see are thrown as `ToolError("fixed English sentence")`; any other throw becomes a generic "Something went wrong" so database text never leaves the server. Amounts come out of `amountFormatter(currencies)` as `{ minor, currency, text }` (an unknown currency code gives `{ minor, currency }` only). No tool adds or compares currencies; totals are per currency. Reads that fall back to an empty or default answer on a database error for the browser (`fetchTransactions`, `getFixedExpenses`, `getSalaryReceiptDates`, `getProfile`) call `throwInConnector()` (`src/lib/supabase/request-context.ts`): inside a connector request they throw, so the tool returns the generic error instead of a valid-looking "nothing"; outside one they behave as before.
- **Read tools (17):**

| Tool | Returns |
| --- | --- |
| `profile_get` | Settings: language, digits, theme, time zone, default currency, last USD to LBP rate, salary email flag, saved salary |
| `currencies_list` | Tracked currencies: code, symbol, decimals, disabled |
| `wallets_list` | Wallets with one balance per currency |
| `categories_list` | Expense and income categories (EN and AR names, parent, archived) |
| `summary_get` | Spending and budgets for the calendar month and the latest salary cycle, per currency |
| `budgets_get` | Per-category limit, spent and left for one month in one currency |
| `transactions_list` | One page of transactions with filters and a cursor; `amount` is the purchase cost, `settlement` what was paid and returned, `toAmount` what a transfer delivered |
| `fixed_expenses_list` | Recurring fixed expenses with amount, due day and the newest payment date since the latest salary (or this calendar month) |
| `installments_list` | Installment plans: total, paid so far, remaining, monthly amount and this cycle's progress (no payment list) |
| `salary_status_get` | Last salary date and whether it falls in the current month |
| `shopping_items_list` | Shopping list with unit price and line total |
| `loans_list` | Loans with principal, fee, paid and remaining |
| `loans_history` | One page of a loan's disbursements and repayments |
| `pending_payments_list` | Jobs others owe the person, with received and remaining |
| `pending_payments_receipts` | Receipts for one pending-payment job |
| `invoices_folders_list` | Invoice folders |
| `invoices_folder_get` | One invoice folder; "Folder not found." for another account's id |

- **Write tools (38)** call the same Server Actions as the screens, so zod validation, RLS, revisions and the database's money rules apply unchanged. Shared pieces are in `src/lib/mcp/write.ts`:
  - `unwrap(result)` turns an action error into a `ToolError` with one fixed English sentence per `ActionError` (`ACTION_ERROR_TEXT`); `failed` and unknown codes become "Could not confirm the change", an unknown outcome.
  - Every input is a `z.strictObject` (unknown keys refused). Amounts are integer minor units, as the read tools return them. The currency-intent header (`expectedUnits`, `x-budget-units`) is built on the server from the person's currency list, never taken from the model.
  - **Retry keys:** every create takes an optional `requestId` (UUID). Where the action has its own request or row id (transactions, transfers, loans, loan payments, pending payments, receipts, salary receipt, shopping items, invoice folders) it is passed through and the database replays the same row. Elsewhere (wallets, categories, fixed expenses, installments) `once()` claims the id in `public.connector_requests` before the change and records the result after; a repeat returns it with `replayed: true`, and an unknown outcome keeps the claim so a retry can never post twice. `wallets_adjust_balance` and `budgets_set` are retry-safe by nature.
  - Results are the updated object re-read through the feature's query, plus `balances` (`balancesOut`, one amount per currency, never summed) whenever money moved. Tools that edit a revision-guarded row require the `revision` from a read.
  - `wallets_adjust_balance` sets a balance to a counted amount by posting the difference as an income or expense in the person's "Balance correction" category (created once per kind), so history stays consistent.

| Area | Tools |
| --- | --- |
| Wallets | `wallets_create`, `wallets_update` (name, kind, position), `wallets_delete` (soft delete; refuses unless every balance is zero), `wallets_adjust_balance` |
| Transactions | `transactions_create` (expense, income, transfer), `transactions_update` (managed rows: date only), `transactions_delete`, `transactions_restore` |
| Categories, budgets | `categories_create`, `categories_update`, `categories_delete` (deletes or archives), `categories_restore`, `budgets_set`, `budgets_delete` |
| Fixed expenses, installments | `fixed_expenses_create` / `_update` / `_delete`, `installments_create` / `_update` / `_delete` |
| Loans | `loans_create`, `loans_update`, `loans_delete` (archived or canceled loans), `loans_record_payment`, `loans_delete_payment` (a reversible void of the latest payment) |
| Pending payments | `pending_payments_create`, `pending_payments_update`, `pending_payments_delete`, `pending_payments_record_receipt` (mark paid or part paid) |
| Salary, profile | `salary_update`, `salary_mark_received` ("Got salary", email included), `profile_update` (default currency, language, theme, digits, salary email) |
| Shopping items, invoice folders | `shopping_items_create` / `_update` / `_delete`, `invoices_folders_create` / `_update` / `_delete` |

  Not exposed: cashier settlements, paying a fixed expense or an installment, invoice rows, categories, paying and sharing, currencies, wallet settle-and-delete, loan cancel/archive and restoring a voided payment, and the USD to LBP rate (the app has no setting for it; it is remembered from exchanges).
- **Consent flow:** Supabase Auth is the OAuth authorization server and the app only draws the consent screen. Claude is a registered app (the person pastes its app id into Claude, see the checklist), then sends the person to Supabase, which redirects to `/oauth/consent?authorization_id=...` (`src/app/oauth/consent/route.ts`). That handler forwards to `/[locale]/connect` (locale from the `NEXT_LOCALE` cookie, then `Accept-Language`, then `en`). A signed-out visitor is sent to sign-in and the validated id is kept in the `connect_authorization` cookie (httpOnly, 1 hour); after sign-in the person returns to the consent screen. Order after sign-in: a pending share link first, then a pending authorization, then onboarding for a new account, then home. `/auth/confirm` follows the same order for email confirmation. The screen shows the app's name and the address the approval is sent to, says the app can see the budget and can add, change and delete it, and that access can be removed later in Settings; Allow or Deny goes through the `decideAuthorization` Server Action (`approveAuthorization` / `denyAuthorization`). The proxy sends `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer` on every `/(en|ar)/connect` response, redirects included.
- **Discovery:** `src/app/.well-known/[...path]/route.ts` serves `oauth-protected-resource` for `/mcp` (naming Supabase as the authorization server) and passes through `oauth-authorization-server`. The 401 from `/mcp` points to it in `WWW-Authenticate`. Other well-known paths are 404 without fetching anything; the Supabase metadata fetch has a 5 s timeout per address.
- **Database guard (reads, plus a list of writes):** a token Supabase issues to a connected app is a full user token with a `client_id` claim, so the database itself limits it (`supabase/migrations/20261209000000_connector_read_only.sql` and `20261210000000_connector_writes.sql`, tests in `supabase/tests/connector_read_only.test.sql` and `connector_writes.test.sql`). `public.connector_request_guard()` is the Data API pre-request hook (`alter role authenticator set pgrst.db_pre_request`) and runs before every PostgREST request, GraphQL included (it is served as `POST /rpc/graphql`). Its rules:
  - No `client_id` claim (a browser session, anon, the secret key): untouched, with no table access.
  - A `client_id` not in `public.connector_clients`: refused with 403 `connector.forbidden`.
  - A registered app: only `GET`/`HEAD` on tables and views in `public`, and `GET`/`HEAD`/`POST` on the read functions in an explicit allowlist (`month_budgets`, `month_category_spend`, `category_spend_between`, `installment_cycle_summary`, each checked to contain only SELECTs). A read runs in a read-only transaction. It may also `POST` the write functions on a second allowlist (18, one per write tool that uses a function, such as `save_transaction`, `record_balance_transfer`, `create_wallet`, `receive_salary`) and send `POST`/`PATCH`/`DELETE` to nine tables, each for exactly the verbs its tools use (`wallets` PATCH; `categories` POST, PATCH; `budgets` POST; `fixed_expenses` and `shopping_items` and `invoice_folders` POST, PATCH, DELETE; `installments` POST, PATCH; `profiles` PATCH; `connector_requests` POST, PATCH, DELETE); those run read-write. Anything else is refused: any other function (even a stable one), any other table write (`transactions` cannot be written directly at all), another schema profile, GraphQL, or a method or path the guard cannot parse. An app can send a listed write straight to the Data API without the tool's input checks; it is then held by what holds a browser session: RLS, constraints, triggers and the function's own rules.
  - Session check: the token's `session_id` must be a canonical lower-case uuid and a live `auth.sessions` row of the same person (`sub`) and the same app (`oauth_client_id`) whose `not_after` has not passed. So an app token works only while its session exists. The lookup runs as the function owner; if the owner cannot read `auth.sessions` every app token is refused (fails closed).
  - Share-link tokens: `invoice_links.token` lets another account join a folder, so a restrictive policy hides those rows from app tokens on every path. The connector's `invoices_folder_get` therefore leaves `linkEnabled` out of its output.
  - `connector_clients` is readable by signed-in accounts and written only with the secret key.
  - **A new write tool must be opened in the guard** (its function body or the table's policies and triggers checked, added to the list in a new migration, with a case in `connector_writes.test.sql`). Until then the database refuses it, whatever the tool code does.
  - `connector_requests` holds the retry keys (one row per person and `requestId`, own rows only by RLS).
- **Removing an app:** Settings, Connected apps, Remove calls `supabase.auth.oauth.revokeGrant({ clientId })` (`revokeConnectedApp` in `src/features/connect/actions.ts`). Supabase deletes the app's session and refresh token. Measured locally (`pnpm test:mcp`, group f): the database refuses the app's earlier access token at once (the session check); `/mcp` refuses it within about a minute (the 60 s cache, keyed by app and session, so another person's use of the same app does not keep it alive); the Auth API (`/auth/v1/user`) and a refresh are refused at once. Removing an app that is already removed counts as done. Refreshing through `/auth/v1/oauth/token` keeps `client_id` and `session_id`; the plain `/auth/v1/token?grant_type=refresh_token` refuses OAuth refresh tokens (checked on the local Auth version only).
- **Signing out:** the app's Sign out (`signOut` in `src/features/auth/actions.ts`) calls `supabase.auth.signOut()`, whose default scope is global. Measured locally (`pnpm test:mcp`, group g): a global sign-out deletes every session of the person, the connected app's session included. The app's access token is then refused by the database at once (403) and by `/mcp` after about a minute (61 s, the 60 s cache); the Auth API and the refresh token refuse it at once. `listGrants` still lists the app, so Settings keeps showing it although it no longer works; the app cannot get a new token without a new approval. Sign-out behaviour is unchanged; whether it should sign out only the browser (`scope: "local"`) is the owner's decision.
- **Settings, Connected apps:** `connected-apps-section.tsx` (Server Component) and `connected-apps-view.tsx` (client island) list the apps the person approved (`getConnectedApps` in `src/features/connect/grants.ts`, via `listGrants()`), each with Remove behind a confirm sheet, and a "Connect Claude" help block with the connector address and the registered app id(s) to paste into Claude (`getConnectorSetup`).
- **Not built yet:** the tools listed under "Not exposed" above, and the completeness test from the design (§6.3) that fails when a Server Action is neither a tool nor on an exclusion list.
- **Known limitations:**
  - **Residual, account takeover through the Auth API (owner decision, see checklist step 3):** the database guard stops writes through the Data API. It does not stop a connected app's token, or anyone who steals it, from using Supabase Auth's own API as the person. Measured locally (`pnpm test:mcp`, groups e and e2, `secure_password_change` on):
    - `PUT /auth/v1/user` with a new password and an app token whose session was just created: 200, the password changed.
    - The same with an app session whose `created_at` was moved back 25 hours: 400 `reauthentication_needed`, unchanged. So the window is the session's first 24 hours.
    - Self-approval works: the app's own access token, as a bearer on the consent screen's call `GET /auth/v1/oauth/authorizations/{id}` for a new authorization request of the same app, is approved at once (the person's consent already exists) and returns a code. Exchanging it gives a token with a NEW session, and with that token the password change is 200 again. So while an app token is valid, its holder can renew the 24 hour window at will.
    - Supabase's "Require current password when changing password" closes the password case. The local CLI (v3.0.0) has no `config.toml` key for it; the Auth server (v2.197) has it as `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD`. Measured on a temporary second local Auth container with it on: an app token without the current password gets 400 `current_password_required`, with a wrong one 400 `current_password_invalid`; a recovery-link session (the app's reset-password page) still sets a new password without it (200). An ordinary signed-in session would need the current password, and the app has no field for it: `/reset-password` used while signed in normally, not from a reset link, would fail. On hosted it is a dashboard setting (not tested there).
    - Email change needs double confirmation. User metadata is writable by an app token.
  - Residual, Auth API: `/auth/v1` ignores `connector_clients`, so a removed app's token is stopped there only because its session is deleted.
  - Residual, Realtime: Realtime and Storage do not go through PostgREST, so neither the guard nor its session check runs for them. The `supabase_realtime` publication holds `invoice_categories`, `invoice_folders` and `invoice_items`. An app token can receive changes on the rows of those tables the person can read, and a removed app's token keeps that until it expires (up to 1 hour; not measured, Realtime's own session handling was not tested). There are no storage buckets. A future bucket or published table must handle `client_id` itself.
  - `MCP_ALLOW_SESSION_TOKENS` must be empty in production. If it were `1`, `/mcp` would accept any ordinary sign-in token (for example one copied from a browser), skipping the approved-app check, and serve the read tools for that token's own account.
  - Residual, authorization ids: an authorization id nobody has opened yet can be approved by the first signed-in person who opens it. Once someone has opened it, other accounts get 404. Accepted: the link only travels to the connecting person's browser.
  - **Residual, fails open:** the guard lives in a role setting. If `authenticator` loses `pgrst.db_pre_request` (role reset, a dashboard change, a restore that skips role settings, a Supabase upgrade), app tokens fall back to ordinary-session access and can make every write a session can. Run `pnpm connector:smoke` after every deploy and every Supabase upgrade (see the checklist).
  - Tokens are not bound to this endpoint's address; they are valid for the whole Supabase project, where RLS and the guard limit them to the person's own data, and at the Data API to reads and the listed writes. The Auth API and Realtime are not covered by the guard (see the residuals below).
  - Hosting under a sub-path is untested; discovery may need a reverse-proxy rule for `/.well-known/...` at the host root.
  - `NEXT_PUBLIC_SITE_URL` must be set in production. Without it the request's Host header decides the address the app advertises.
  - The Supabase OAuth server is a beta feature. The guard relies on Supabase internals (`auth.sessions`, the `session_id` claim) that are not a public contract.
  - The real consent screen and Settings block were checked at 390px (EN and AR) only. Nothing has connected from Claude itself yet, and nothing has been done on the hosted project.

### Hosted go-live checklist

The owner does every step, in this order. Nothing below has been done on the hosted project yet. What was only verifiable on hosted is proven in step 6, with what each failure means.

**How the scripts pick their target.** `pnpm connector:register` and `pnpm connector:smoke` run `node --env-file=.env.local …`. They read `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` (the smoke script also `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) from `.env.local`; a variable already set in the shell wins over the file. So they target production when `.env.local` holds the production URL and secret key, or when you set those variables in the shell for that one command. For any host other than `127.0.0.1`/`localhost` they print the host and send nothing until you type it back.

1. **Migrations.** First confirm `20261209000000_connector_read_only.sql` was never applied on hosted: `pnpm exec supabase migration list --linked` (after `pnpm exec supabase link --project-ref <ref>`) must not show it as applied remotely. It was edited in place while only applied locally; if hosted already ran an earlier version, stop and report it. Then apply the migrations (`pnpm exec supabase db push`). The connector migration sets the pre-request hook on `authenticator` and reloads the config.
2. **Hook check by SQL** (SQL editor). The setting must be there:

```sql
select rolconfig from pg_roles where rolname = 'authenticator';
-- must contain pgrst.db_pre_request=public.connector_request_guard
```

   Then run the guard once as an unknown app would reach it. The last `select` must fail with `ERROR: connector.forbidden`:

```sql
begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated","client_id":"not-a-registered-app","session_id":"00000000-0000-4000-8000-000000000000"}', true);
select set_config('request.method', 'GET', true);
select set_config('request.path', '/wallets', true);
select set_config('request.headers', '{}', true);
select public.connector_request_guard();
rollback;
```

   If the setting is missing, set it (`alter role authenticator set pgrst.db_pre_request = 'public.connector_request_guard'; notify pgrst, 'reload config';`) and check again.
3. **Supabase dashboard, Authentication:**
   - OAuth Server on, authorization path `/oauth/consent`, dynamic client registration **off**.
   - Secure password change on. Double-confirm email change on. Site URL is the production address (`https://<domain>`).
   - **Gate, owner decision: "Require current password when changing password".** Without it, a connected app's token (or a thief of it) can change the account password and so take the account over (see Known limitations; self-approval keeps the window open). Measured locally, it closes that and the reset-password link still works; signed in normally, `/reset-password` would then fail. Even with it on, an app token can still self-approve new sessions and write user metadata. Decide explicitly: turn it on, or accept the takeover residual in writing. If on, test on hosted that sign-up, sign-in and forgot-password still work.
   - Confirm and note the state of: MFA enrolment, manual identity linking, storage buckets (none expected), and any other OAuth clients listed under the OAuth Server (only the ones you register should be there).
4. **Register Claude:** `pnpm connector:register "Claude"` against production (see "How the scripts pick their target"; type the host back) and note the app id it prints.
5. **Deploy** with `NEXT_PUBLIC_SITE_URL=https://<domain>` and `MCP_ALLOW_SESSION_TOKENS` empty. Consider asymmetric JWT signing keys (Supabase recommends them for OAuth; required only for the `openid` scope).
6. **Smoke check:** `pnpm connector:smoke` against production. It creates a throwaway confirmed user and a throwaway registered app, checks, and deletes both in `finally`. One PASS/FAIL line per check:
   - **Ordinary session reads (200).** Ordinary sessions return from the guard before any path or session check, so a different `request.path` shape cannot refuse them. If this fails, something else is wrong (RLS, grants, the API): roll back and investigate.
   - **App token reads (200).** This proves the guard reads `auth.sessions`, that `auth.sessions.oauth_client_id` is the app's client id, and that `request.path` has the shape the guard parses (`/name` or `/rpc/name`). If it is 403: the owner cannot read `auth.sessions`, or hosted stores `oauth_client_id` differently, or the path shape differs (each refuses app tokens only). Roll back and report it.
   - **Unlisted writes refused** (`POST /rest/v1/rpc/create_currency` and `PATCH /rest/v1/transactions`, each 403 `connector.forbidden`). This proves PostgREST calls the hook. Anything else means app tokens can do everything a session can (fails open): set the hook again (step 2) before anything else.
   - **A listed write works** (`POST /rest/v1/rpc/create_wallet` 200, one wallet for the throwaway user). A 403 means `20261210000000_connector_writes.sql` is not applied or the API has not reloaded its config; the write tools would fail.
   - **GraphQL refused for the app** (or "not exposed" when an ordinary session gets no GraphQL answer). If the app gets an answer, turn the `pg_graphql` extension off.
   - **Refresh keeps `client_id` and `session_id`**, and the refreshed token is still held to the list. If the claim is lost the token looks like an ordinary session and `/mcp` refuses it: roll back and report it.
   - **Removal:** after `revokeGrant` the database refuses the token. If not, the session check does not work: roll back and report it.
   - If the script cannot create its throwaway app (for example hosted refuses the `http://localhost:8976/callback` redirect address), nothing above was proven: report it.
7. **Connect Claude:** in Claude add a custom connector with the address `https://<domain>/mcp` and, under advanced settings, the app id from step 4. Sign in, choose Allow, then ask a read question such as "what did I spend this month?".
8. **Remove it:** in Settings, Connected apps, remove Claude and confirm Claude loses access within about a minute.
9. **After every deploy and every Supabase upgrade:** run `pnpm connector:smoke` again (the hook lives in a role setting and fails open if it is lost).

**Rollback** (in this order). First stop every app: remove each registered app while the OAuth server is still on (`pnpm connector:register --remove <id>`), then turn the OAuth server off in the dashboard. Then wait one hour (the access token lifetime) before resetting the hook. The Data API checks only a token's signature and expiry; the session check lives in the guard, so an app token issued in the last hour becomes an ordinary read-write token the moment the hook is reset.

```sql
alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';
drop policy "Connected apps cannot read share links" on public.invoice_links;
drop function public.connector_request_guard();
drop table public.connector_clients;
```

### Testing the connector

- Unit tests sit next to the code (`mcp.test.ts` per feature, `src/lib/mcp/*.test.ts`, `src/app/mcp/*.test.ts`); Playwright `e2e/connect.spec.ts` covers the expired-link state in EN and AR in demo mode.
- `pnpm test:mcp` runs `scripts/test-mcp.mjs` against the local Supabase stack. It needs `pnpm db:start` with all migrations applied, and the app running against that stack (not `.env.local`, which may point at a hosted project) as the header of the script describes (with `MCP_ALLOW_SESSION_TOKENS=1` for the password-session groups) and `MCP_TEST_APP_URL` set to its address (default `http://localhost:3000`). It reads URL and keys from `supabase status`, refuses to run unless the API host is `127.0.0.1` or `localhost`, creates four throwaway confirmed users and one throwaway registered app, and deletes them at the end. Before creating users it reads the app's discovery document and stops unless the authorization server it names is the local stack. It checks: 401 and discovery without a token; a real token accepted and a tampered one rejected; a session cookie is rejected at `/mcp`; exactly the 55 tools with the hints of their kind; each read tool works with a password session and again with a registered app's token (through the guard); the write tools, with the app's token, change the account's data and return it, repeated `requestId`s post once, one USD balance is followed step by step, inputs are strict, and a second account can neither see nor change any of it (group w); one account cannot see another's data; with a real OAuth-issued token of a registered app (no browser): `/mcp` and the database accept reads, a write no tool makes is 403, an unregistered app is refused, dynamic registration is refused, and after the person removes the app the database refuses at once and `/mcp` within 65 s. It measures the password change and self-approval by an app token (groups e and e2): either one FAILS the run unless `MCP_ACCEPT_PASSWORD_RESIDUAL=1` (a test flag for when the owner has accepted that residual). It also measures what a global sign-out does to a connected app (group g, printed, not asserted). `pnpm db:test` runs the SQL tests, including `connector_read_only.test.sql` and `connector_writes.test.sql`.
- `pnpm connector:smoke` runs `scripts/connector-smoke.mjs` against whichever project its environment points at (see the checklist for how it picks it). It needs no running app. It creates a throwaway confirmed user (signed in with a one-time admin link, so no email and no CAPTCHA) and a throwaway registered app, prints one PASS/FAIL line per check (ordinary session reads; app token reads; unlisted writes refused; a listed write works; GraphQL refused or not exposed; refresh keeps `client_id` and `session_id` and stays held to the list; reads and writes refused after `revokeGrant`), deletes both in `finally`, and exits non-zero on any failure. It never prints tokens or keys. Run so far against the local stack only.
