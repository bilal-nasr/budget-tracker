# 09 · Open sign-up with email verification

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. No commit steps (owner commits).

**Goal:** Anyone can create an account with email and password; the account works only after they click the link in a verification email; each account sees only its own data.

**Owner note:** "Allow signup new accounts (email verification)."

**This reverses a product rule.** `PRODUCT.md`, `docs/ARCHITECTURE.md` §3 and `CLAUDE.md` ("Single owner: sign-ups stay disabled; `OWNER_EMAIL` is enforced") all say one owner account. Task 6 updates them in the same change. The data side is already ready: every table has RLS on `user_id`, and the bootstrap trigger in `20261104000000_profiles_categories.sql` gives each new user a profile and 12 starter categories.

**Architecture:**
- Supabase Auth with `enable_signup = true` and `enable_confirmations = true` (local `supabase/config.toml` and the hosted dashboard).
- Confirmation email links to `{SITE_URL}/auth/confirm?token_hash=…&type=email&next=/{locale}/onboarding`. A Route Handler at `src/app/auth/confirm/route.ts` (outside `[locale]`, so the proxy matcher `/(en|ar)/:path*` does not touch it) calls `auth.verifyOtp`, which signs the user in, then redirects to `next`.
- `OWNER_EMAIL` enforcement is removed from `signIn` (`src/features/auth/actions.ts`) and `refreshSession` (`src/lib/supabase/proxy.ts`). The Supabase "allow new users to sign up" toggle is the kill switch.
- New pages: `/[locale]/sign-up` and `/[locale]/check-email`. The proxy lets signed-out visitors reach sign-in, sign-up and check-email.

**Tech stack:** `@supabase/ssr`, Supabase Auth (signUp, verifyOtp, resend), local Mailpit/Inbucket on port 54324 for tests.

## Global constraints

All of [README § Global constraints](README.md#global-constraints-every-plan-every-task).

## Before writing code (owner decisions)

- [ ] **Email delivery.** Hosted Supabase's built-in mailer sends only to addresses of the project's team members and is heavily rate-limited, so verification emails to anyone else will not arrive. Choose an SMTP provider (Resend, Postmark, Amazon SES, Brevo) and set it in Dashboard → Authentication → SMTP. Needs a domain you control for the sender address.
- [ ] **Bot protection.** Open sign-up invites scripted sign-ups. Supabase supports Cloudflare Turnstile or hCaptcha (Dashboard → Authentication → Bot and Abuse Protection). Recommended; it adds one widget to the sign-up form (an extra task, not in this plan).
- [ ] **Password reset.** Once other people have accounts, "reset it in the dashboard" no longer works. Recommended as a follow-up plan using the same email setup.

## Review focus

- `next` in the confirm link is attacker-controllable: only same-site relative paths matching `^/(en|ar)(/[\w-]*)*$` are honoured; anything else redirects to `/{defaultLocale}`. No open redirect.
- Sign-up with an email that already exists: same "Check your email" screen (Supabase returns an obfuscated user when confirmations are on), so the form does not reveal who has an account.
- Sign-in before confirming: Supabase returns `email_not_confirmed`; show "Confirm your email first" with a Resend button (only reachable with the right password, so it leaks nothing new).
- Expired or reused confirmation link: `/auth/confirm` redirects to sign-in with `?error=link` and a message "This link has expired. Sign in to get a new one."
- Two accounts: user B must not see any of user A's wallets, transactions, fixed expenses, installments, budgets or profile (the Phase 2/3 live checks that are still open in `docs/PLAN.md`).

---

### Task 1: Supabase config

**Files:**
- Modify: `supabase/config.toml` (`[auth] enable_signup = true`, `site_url = "http://localhost:3000"`, `additional_redirect_urls` include `http://localhost:3000/auth/confirm`; `[auth.email] enable_confirmations = true`; `[auth.rate_limit] email_sent` stays low)
- Create: `supabase/templates/confirmation.html` and set `[auth.email.template.confirmation] subject = "Confirm your Budget Tracker account"`, `content_path = "./supabase/templates/confirmation.html"`. The link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}`. Bilingual body (English then Arabic, `dir="rtl"` block).
- Modify: `.env.example` (remove `OWNER_EMAIL`; add `NEXT_PUBLIC_SITE_URL`)

- [ ] **Step 1:** Edit config; `pnpm db:stop && pnpm db:start`. Expected: Studio → Authentication shows sign-ups enabled.
- [ ] **Step 2:** Hosted dashboard: same toggles, Site URL = production URL, redirect URL `https://<domain>/auth/confirm`, paste the template, SMTP configured. Record the date here.

### Task 2: Confirm route

**Files:**
- Create: `src/app/auth/confirm/route.ts`, `src/features/auth/redirect.ts`, `src/features/auth/redirect.test.ts`

**Interfaces:**
- `safeNext(next: string | null): string`: returns `next` when it matches `^/(en|ar)(/[\w-]*)*$`, else `"/en"`.
- `GET(request: NextRequest)`: reads `token_hash`, `type` (`email` only), `next`; `await supabase.auth.verifyOtp({ type: "email", token_hash })`; success → `NextResponse.redirect(new URL(safeNext(next), request.url))`; failure → redirect to `/{locale}/sign-in?error=link`.

- [ ] **Step 1: Write the failing tests:** `safeNext("/ar/onboarding") === "/ar/onboarding"`; `safeNext("//evil.com") === "/en"`; `safeNext("https://evil.com") === "/en"`; `safeNext("/en/../x") === "/en"`; `safeNext(null) === "/en"`.
- [ ] **Step 2:** `pnpm test`. Expected: FAIL. Implement both; re-run; PASS.

### Task 3: Sign-up action and pages

**Files:**
- Modify: `src/features/auth/actions.ts`
- Create: `src/app/[locale]/(auth)/sign-up/page.tsx`, `src/app/[locale]/(auth)/sign-up/sign-up-form.tsx`, `src/app/[locale]/(auth)/check-email/page.tsx`
- Modify: `src/app/[locale]/(auth)/sign-in/sign-in-form.tsx` (link "Create an account"; `email_not_confirmed` state with Resend; `?error=link` message), messages (`Auth` namespace)
- Test: `e2e/auth.spec.ts`

**Interfaces:**

```ts
export type SignUpState = { error: "invalid" | "notConfigured" | "weakPassword" | "failed" | null };
/** Always redirects to /{locale}/check-email on success, whether or not the email already had an account. */
export async function signUp(prev: SignUpState, formData: FormData): Promise<SignUpState>;
export async function resendConfirmation(email: string, locale: Locale): Promise<{ ok: boolean }>;
```

zod: email (trimmed, lowercased), password `min(8).max(72)`, locale. `signUp` calls `supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${NEXT_PUBLIC_SITE_URL}/${locale}/onboarding` } })`. `signIn` drops the `OWNER_EMAIL` check and maps `email_not_confirmed` to a new `"unconfirmed"` error.

Form fields: email (`type="email"`, `autoComplete="email"`), password (`autoComplete="new-password"`, show/hide toggle, help "At least 8 characters"). Same visual shell as sign-in.

- [ ] **Step 1: Write the failing e2e tests** (demo mode shows the form; the submit returns `notConfigured`): sign-up page reachable from sign-in in EN and AR; field attributes as above; password under 8 characters shows the error and does not submit; no horizontal overflow at 320/390.
- [ ] **Step 2:** `pnpm test:e2e e2e/auth.spec.ts`. Expected: FAIL. Implement; re-run; PASS.
- [ ] **Step 3: Local live test** with `pnpm db:start` and `.env.local` pointing at the local stack: sign up `test1@example.test`, open Mailpit at `http://127.0.0.1:54324`, click the link, land on onboarding signed in; sign up the same email again → check-email screen, no second account; sign in before confirming a second address → "Confirm your email first" + Resend.

### Task 4: Proxy without the owner rule

**Files:**
- Modify: `src/proxy.ts` (public paths: `sign-in`, `sign-up`, `check-email`), `src/lib/supabase/proxy.ts` (`refreshSession` returns `{ email }` with no owner check; if plan 01 landed, it already uses `getClaims`)
- Delete: the `OWNER_EMAIL` reads in `src/features/auth/actions.ts` and `src/lib/supabase/proxy.ts`

- [ ] **Step 1:** Extend `e2e/smoke.spec.ts` (with Supabase env set in a separate Playwright project, or as a manual check if that is not set up): signed-out `/en/sign-up` and `/en/check-email` are reachable; `/en/activity` still redirects to sign-in; signed-in `/en/sign-up` redirects to `/en`.
- [ ] **Step 2:** Implement; run; PASS.

### Task 5: Two-account isolation check

- [ ] **Step 1:** pgTAP `supabase/tests/isolation.test.sql`: as user B, `select count(*)` is 0 on `profiles` (other than B's), `wallets`, `transactions`, `fixed_expenses`, `categories` (other than B's), `installments`, `budgets`, `wallet_balances`, `installment_progress`; inserts referencing A's wallet or category raise. Include tables from plans 07 and 08 only if they exist.
- [ ] **Step 2:** `pnpm db:test`. Expected: PASS (RLS already exists; this pins it).
- [ ] **Step 3:** Live, on the hosted project, with a second real inbox: sign up, confirm, onboard, see empty data and the starter categories; then tick the open Phase 2 and Phase 3 live checks in `docs/PLAN.md`.

### Task 6: Update the project rules

**Files:**
- Modify: `PRODUCT.md` (Users: open sign-up with email verification), `docs/ARCHITECTURE.md` §3 (rewrite: sign-up, confirmation flow, no owner check, password reset still TODO), `CLAUDE.md` ("Single owner" rule → "Open sign-up with email verification; RLS isolates accounts"; `pnpm owner:create` stays as an admin tool), `README.md` env section, `docs/PLAN.md`
- Keep: `scripts/create-owner.mjs` (still useful to create an account without email)

- [ ] **Step 1:** Edit the docs. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`. Expected: PASS.
- [ ] **Step 2:** Run `/security-review` on the branch before enabling sign-ups on the hosted project.
