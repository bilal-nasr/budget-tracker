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
- Accounts are isolated by RLS (`user_id = (select auth.uid())` on every table); `supabase/tests/isolation.test.sql` checks that one account cannot read or write another's data. A bootstrap trigger gives each new user a profile and starter categories.
- `proxy.ts` refreshes the session on every request (`getClaims`, verified locally) and redirects signed-out visitors to `/[locale]/sign-in`; sign-in, sign-up and check-email are public.
- Hosted setup needs a custom SMTP provider: Supabase's built-in mailer only sends to the project's own team members and is heavily rate-limited.
- Bot protection: set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to show a Cloudflare Turnstile check on sign-in and sign-up (the token also goes with "send the link again"). It only helps when captcha protection is also turned on in the Supabase dashboard (Authentication > Bot and Abuse Protection) with the Turnstile secret; also lower the email rate limit there. Without both, anyone can trigger confirmation emails to any address.
- Confirmation redirects use `NEXT_PUBLIC_SITE_URL` (not the request's own address, which is internal behind a proxy or in Docker).
- Password reset: `/[locale]/forgot-password` emails a link (always the same "link is on its way" answer, with the bot check); the link goes through `/auth/confirm` with `type=recovery`, which signs the person in and sends them to `/[locale]/reset-password` to choose a new password. Paste `supabase/templates/recovery.html` into Supabase (Authentication > Emails > Templates > Reset password).
- Not built yet: account deletion, a "change password" screen in Settings.
- Later option: passkeys / WebAuthn.

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

All tables live in `public`, all have `user_id uuid not null default auth.uid() references auth.users`, and RLS policy `user_id = (select auth.uid())` for select/insert/update/delete. Amounts are `bigint` minor units with `check (amount_minor > 0)`; sign comes from `kind`, never from a negative number.

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

- `lib/money.ts` is the only place that parses or formats amounts. USD has 2 decimals, LBP has 0.
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
