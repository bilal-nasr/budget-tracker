# Build Plan

Phased, each phase ends with something usable on the phone. A phase is done when its acceptance list passes **and** the mobile definition of done (`docs/MOBILE-UX.md` §14) passes for every screen it touched.

Status: ☐ not started · ◐ in progress · ☑ done

---

## Phase 0: Foundation ◐ (code done; 2 items deferred, see notes)

Goal: an empty, deployable, bilingual app skeleton.

- [x] Scaffold Next.js (App Router, TypeScript strict, Tailwind v4, ESLint, Turbopack), pnpm.
- [x] `output: "standalone"`, optional `basePath` from env, `Dockerfile`, `.env.example`.
- [x] shadcn/ui + bottom sheet: done in Phase 1, generated against the approved tokens.
- [x] `next-intl` with `/en` and `/ar`, `<html lang dir>`, `messages/en.json` + `ar.json`, key-parity test.
- [x] Lint rule banning physical direction utilities (`ml-`, `pr-`, `left-`, `text-left`…).
- [x] Supabase: CLI installed, `config.toml` with `enable_signup = false`, `@supabase/ssr` server/browser/proxy clients.
- [ ] Typed client (`pnpm db:types`): needs the local stack (Docker daemon was off) and the first migration (Phase 2).
- [x] `proxy.ts`: session refresh, locale detection, auth redirect, `OWNER_EMAIL` check.
- [x] Vitest + Playwright configured with projects `mobile-small`, `iphone` (WebKit), `android`, `desktop`; shared "no horizontal overflow" helper.
- [x] Viewport meta (`viewport-fit=cover`, `interactive-widget=resizes-content`), safe-area CSS variables.

Notes: Next 16 scaffolds `cacheComponents`; it is **off** here (the app is auth-gated and dynamic, and it adds Suspense friction for no gain). Node 22 LTS is the baseline. Dockerfile written but the image build is untested (Docker daemon was off); the standalone server was verified instead.

Acceptance: `pnpm build` passes; `/en` and `/ar` render a placeholder with correct `dir`; the Docker image runs locally; e2e smoke passes on all four projects.

## Phase 1: Design direction ☑

Goal: an approved visual world before building real screens.

- [x] Static mockups at 390px (Home, Add sheet, Activity, Budgets) in EN + AR for three worlds: `docs/mockups/directions.html`.
- [x] Owner chose **A · Encaustic tile**; in-sheet keypad; Latin digits in Arabic. Direction contract recorded in `.impeccable/surfaces/src-app-locale.md`.
- [x] shadcn/ui (base-nova on Base UI, RTL mode, all sizes >= 44px) with its Base UI Drawer as the bottom sheet (replaces the planned `vaul`).
- [x] Tokens in `globals.css` (light + provisional dark), Readex Pro for Latin and Arabic, theme script, tile glyphs, TileBar, Amount, AmountKeypad (+ tests), Segmented, Skeleton, toast.
- [x] Dev-only kitchen sink at `/[locale]/dev/kitchen-sink`; verified no horizontal overflow at 320, 390 and 1440 in EN and AR, including the open sheet.
- [x] Finish review (verdict: fix, all material fixes applied), `DESIGN.md` and `.impeccable/design.json` written. Carried to Phase 2: tile-pattern band on the shell and tile ornament on empty states.

## Phase 2: Auth, shell, onboarding ☑ (owner sign-in verified; three live checks left, see below)

- [x] Migration `supabase/migrations/20261104000000_profiles_categories.sql`: `profiles`, `categories`, RLS, one-level subcategory trigger, bootstrap trigger that seeds a profile and 12 bilingual categories per new user. Applied to the hosted project.
- [x] `pnpm owner:create` script (exists; needs the secret key).
- [x] Sign-in page and action (owner email checked before Supabase; same error for wrong email or password), sign-out.
- [x] App shell: phone bottom bar with raised Add, tablet rail, desktop sidebar; month switcher (`?month=YYYY-MM`); shell header with tile-pattern band; empty states with tile ornament; Add opens a placeholder sheet.
- [x] Settings: language, digits, theme, sign out (saves to profile when Supabase is configured).
- [x] First-run onboarding: **step 1 (language) only**. The wallet step moves to Phase 3 and the budgets step to Phase 4, when their tables exist.
- [x] E2E: every route in EN and AR at 320 / 390 / 412 / 1280, one navigation per size, 44px nav targets, Add sheet, language switch, sign-in field attributes (72 tests).
- [x] Migration applied to the hosted project (2026-11-04).
- [x] Owner sign-in verified against the hosted Supabase (2026-11-04).
- [ ] Still unverified live: a second account is rejected, settings save to the profile, starter categories exist for the owner.

Notes: without Supabase env vars the proxy skips auth and the profile falls back to defaults, so the UI is previewable on a fresh checkout.

Acceptance: only `OWNER_EMAIL` can sign in (test with a second account, which is rejected); shell passes the mobile definition of done at all widths in EN/AR; switching language flips direction without reload glitches.

## Phase 3: Wallets & transactions ◐ (migration applied; live checks pending)

- [x] Migration `supabase/migrations/20261105000000_wallets_transactions.sql`: `wallets`, `transactions` (expense/income), integrity trigger (own wallet and category, kind match, no archived wallet, currency copied from wallet), currency lock after history, RLS, soft delete, keyset-feed index, `wallet_balances` view. Applied to the hosted project (2026-11-05).
- [x] Wallets screen: grouped by currency with a separate total each, add / edit / archive sheet, "I have / I owe this money" opening balance.
- [x] Add / edit sheet: Expense or Income, in-sheet keypad (000 for LBP, decimals for USD), category grid with "More", wallet picker, collapsed date and note, Save pinned, Undo toast. Duplicate and delete (soft, with Undo) from the detail sheet.
- [x] Activity: day groups with per-currency day totals (hidden on a still-loading last day), search notes, All / Expenses / Income, filter sheet (wallet, category, dates), keyset "Load more" plus auto-load, empty and no-results states.
- [x] Home v1: money per currency, 5 recent, wallet strip. (Becomes "Left to spend" in Phase 4.)
- [x] Onboarding step 2: first wallet (skippable).
- [x] Synthetic demo data when Supabase is not configured, so layouts are testable; writes say "preview".
- [x] 104 e2e tests (EN/AR, four device sizes), 16 unit tests.
- [ ] Verify live (migration is applied): create wallet, log expense with Undo, balances, edit, delete and restore, second account cannot see data.
- [ ] SQL tests (need local Supabase or a rollback-only run on the hosted database).
- [x] Salary (added on request): fixed amount + wallet saved once, **Got salary** button on Home adds it as income with Undo, asks before a second add in the same month, entries tagged `source = salary`. Migration `20261106000000_salary.sql` applied to the hosted project.
- [x] **Aa** key on the keypad opens the note field for a custom label.
- [x] Move money between wallets (added on request): Move tab in Add (same currency, or an exchange where you enter exactly what arrived, no guessed rates); "Add money" on a wallet (new money, or taken from another wallet); a new wallet funded from another wallet; moves show in Activity with a Moves filter and never count as income or spending. Migrations `20261109000000_transfer_kind.sql` and `20261109000100_transfers.sql`.
- [x] Fixed expenses (added on request): monthly templates (name, amount, wallet, category, optional due day) on Home; **Paid** records the expense and deducts it from its wallet, with Undo; shows "left to pay" per currency. Migration `20261108000000_fixed_expenses.sql`.
- [x] Archived wallets: restore, or delete permanently (only when it has no transactions). Migration `20261107000000_wallet_delete.sql` applied to the hosted project.
- Deferred: deep-linkable `/transactions/[id]` route, spending-by-usage category order, search over category names.

Notes: content column is 800px on desktop for now (was 1120) so amounts sit near their titles. iOS Safari ignores the `interactive-widget` viewport hint, so keyboard behaviour in sheets needs a real-iPhone check.

Acceptance: log an expense in 4 taps plus amount on a real phone; balances match the database; 100+ seeded transactions scroll smoothly; Add works with the keyboard open on iOS Safari and Android Chrome.

## Phase 3b: Owner feedback round 2 ☐

Ten notes from the owner (2026-11-03), planned task by task in [`docs/plans/`](plans/README.md).

- [x] [01 Speed](plans/01-performance.md): loading skeletons, one round trip per write, local JWT checks, optimistic Paid / Got salary.
- [x] [02 Language and theme](plans/02-language-and-theme.md): one navigation per language tap; theme kept on switch.
- [x] [03 Confirm Got salary](plans/03-salary-confirm.md): confirmation sheet every time.
- [x] [04 Add sheet](plans/04-add-sheet-name-and-category.md): visible Name field; category dropdown (also in the fixed-expense sheet).
- [x] [05 Fixed totals](plans/05-fixed-totals.md): per-wallet needs, total fixed, salary after fixed.
- [x] [06 Exchange rate](plans/06-exchange-rate-move.md): `1 $ = [ ] LBP` in Move, editable result, rate saved on the profile (also serves as Phase 5's reference rate).
- [x] [07 Installments](plans/07-installments.md): total, what is left, payment history, default wallet with per-payment override.
- [x] [08 Budgets](plans/08-budgets.md): implements the budget items of Phase 4 below.
- [x] [09 Sign-up](plans/09-signup.md): open sign-up with email verification. Changes the single-owner rule; needs an SMTP provider first.

## Phase 3c: Owner feedback round 3

Implementation plans and integrated verification are recorded in [round 3](plans/round-3/README.md). The owner approved all eight features plus the additional Move UX change, followed by a combined commit and push.

- Category CRUD with archive/restore for used categories and retained budgets/history.
- Optional descriptive expense items, atomic saves and revision-aware Undo.
- Persistent auth refresh cookies and a native 30-day session timebox configuration.
- Cashier tender/change with actual wallet movements and confirmed currency conversion.
- Installment paid status per salary receipt cycle, with deliberate repeat payment.
- Current/new SYP currency and compact Move selectors with explicit received-amount editing.
- Borrowed/lent loans with a one-time percentage fee and fee-only reporting.
- Shared Arabic numeric input direction, touch-selection and raw-draft handling.

Round-3 migrations were applied to production on 2026-11-04 after an application-data/schema backup. All 18 migration records now match the repository. The populated PostgreSQL 17 rehearsal covers legacy payment backfill, and production financial records/balances were verified unchanged. See the [production follow-up](plans/round-3/README.md#production-follow-up--2026-11-04) for history alignment and the deferred-trigger fix. Hosted Auth timebox configuration and a physical-iPhone native-keyboard check remain separate verification steps.

## Phase 4: Categories & budgets ◐

- [x] Categories manager (Settings): bilingual names, motif, colour, unused deletion, archive/restore and protected history.
- [ ] Category hierarchy editor and manual reorder (existing hierarchy references remain protected).
- [x] Migration `20261110000200_budgets.sql` (`budgets`, `month_budgets`, `month_category_spend`, carry-forward) + `supabase/tests/budgets.test.sql`. Not yet applied or run.
- [x] Budgets screen: month switcher, currency segment, category rows with progress and over-limit state, category month detail.
- [x] Edit budgets sheet with running total.
- [x] Home v2: "Left to spend this month" per currency + over-budget callout.
- [x] Add from a budget row pre-selects the category.

Acceptance: budgets carry into a new month automatically; over-budget is shown with icon + text; Home answers "how am I doing" above the fold at 390 × 844.

## Phase 5: Transfers, exchange & rates ☐

- [ ] Extend `transactions` with transfer (same currency) and exchange (USD↔LBP, two amounts) + constraints and tests.
- [ ] "Move" mode in the Add sheet; "Move money" from wallet detail.
- [ ] Reference rate in Settings; "≈" hints on wallet totals and Home (always labelled, never summed into real totals).

Acceptance: "paid $20, got LBP change" is recordable as one exchange; balances in both wallets are correct; no screen ever adds USD to LBP.

## Phase 6: Reports ☐

- [ ] Reports screen: donut by category + text table, 6-month spending bars, tap-to-inspect, link to filtered Activity.
- [ ] Charts lazy-loaded, accessible text equivalents, no page-level horizontal scroll.

Acceptance: report totals equal `month_summary`; charts usable by touch and keyboard; Reports route JS stays within budget.

## Phase 7: PWA, polish & launch ☐

- [ ] Manifest, icons (incl. maskable), shortcuts, iOS meta, `@serwist/next` service worker (offline read of last Home/Activity).
- [ ] Performance pass against `docs/ARCHITECTURE.md` §8 on a mid-range Android.
- [ ] Accessibility pass: axe, VoiceOver, TalkBack, 200% text.
- [ ] Arabic copy review by a native reader.
- [ ] `/impeccable polish` + `/impeccable audit` on every screen.
- [ ] Production: hosted Supabase project, migrations applied, owner account created, deploy to the owner's site over HTTPS, backups enabled.

Acceptance: installs to the home screen on iPhone and Android and opens straight into the app; "Add expense" shortcut works; Lighthouse mobile ≥ 90 in Performance/Accessibility/Best Practices.

## Phase 8: Claude connector (MCP) ◐

Design: `docs/superpowers/specs/2026-11-24-mcp-connector-design.md`. Phase 1 below is built on the branch and proven locally only.

### Connector phase 1: connect, sign in, read

- [x] `/mcp` endpoint with bearer-token identity, no cookies; discovery route.
- [x] Consent screen at `/[locale]/connect` (EN and AR) with sign-in return, built to the approved mockup.
- [x] 17 read tools.
- [x] `pnpm test:mcp` passes (16 groups now, see hardening below) against the local Supabase stack (401s, discovery, real and tampered tokens, cookie alone rejected, 17 tools, each tool, cross-account isolation, cleanup).
- [x] Real local OAuth flow checked: register, sign in, Allow (code and token), Deny (`access_denied`), repeat authorize skips the screen, token accepted by `/mcp`.
- [ ] Hosted switch-on (see "Hosted go-live checklist" in `docs/ARCHITECTURE.md` §10) and a real connection from Claude.
- Clean-up from the build ledger and the final review:
  - [x] `transactions_list`: settlement tender, extra tenders, change, item lines and a transfer's received amount formatted in their own currencies; description says which currency each amount is in.
  - [x] `installments_list` no longer promises (or returns) a payment history it never fills.
  - [x] `loans_list` / `loans_history` say archived and deleted rows are included and flagged; `invoices_folder_get` says the owner also sees removed members; `fixed_expenses_list` describes `paidOn` as the query computes it.
  - [x] Database errors in tool reads (`fetchTransactions`, `getFixedExpenses`, `getSalaryReceiptDates`, `getProfile`) throw inside a connector request instead of answering "nothing"; browser behaviour unchanged.
  - [x] A Supabase Auth outage while checking a token answers 500, not 401 `invalid_token`.
  - [x] Discovery metadata fetch has a 5 s timeout; unknown well-known paths are a 404 before any fetch.
  - [x] Consent screen cannot be framed (`frame-ancestors 'none'`, `X-Frame-Options: DENY`); the "remove its access later in Settings" line is gone until that screen exists.
  - [x] Transaction cursor `createdAt` accepts timestamp characters only.
  - [x] `pnpm test:mcp` confirms the app uses the local stack before running, proves its session cookie signs in on a page before checking it is refused at `/mcp`, and checks `wallets_list` shows the new balance formatted.
  - [ ] "Expired claims" route test.
- [x] Settings "Connected apps": list of approved apps with Remove behind a confirm sheet, and a "Connect Claude" help block (address and app id). Built to the approved mockup, EN and AR, with component and e2e tests.
- [x] Authorization-id question decided: an id nobody has opened yet can be approved by the first signed-in person who opens it; once opened, other accounts get 404. Accepted and documented (`docs/ARCHITECTURE.md` §10). No repeatable test pins it.

### Connector hardening (design §9): proven locally, hosted steps open

- [x] Connected apps are read-only in the database: `connector_request_guard()` as the PostgREST pre-request hook, read-function allowlist, read-only transaction, share-link tokens hidden from apps; `supabase/tests/connector_read_only.test.sql` passes.
- [x] Only registered apps are accepted (`connector_clients`, `pnpm connector:register`), by the database and by `/mcp`; dynamic registration is off locally.
- [x] Removing an app cuts it off: the database refuses its token at once, `/mcp` within about a minute, the Auth API and refresh at once (measured by `pnpm test:mcp`, group f).
- [x] `pnpm test:mcp` passes all 19 groups against the local stack with `MCP_ACCEPT_PASSWORD_RESIDUAL=1`, including all 17 tools with a real OAuth-issued token for a registered app. Without the flag the two password groups fail, as they should while the residual is open.
- [x] Password and self-approval measured: with secure password change on, an app's token can change the password while its session is under 24 hours old, and it can approve a new authorization for its own app (a new session, a new window). "Require current password" closes the password case (measured on a temporary local Auth container; the reset link still works). Written down in `docs/ARCHITECTURE.md` §10.
- [x] Global sign-out measured (`pnpm test:mcp`, group g): the app's token stops working, but Settings still lists the app. Behaviour unchanged; owner decides.
- [x] `pnpm connector:smoke` proves the guard on a project with a throwaway user and app (local stack only so far).
- [ ] Owner decision: turn on "Require current password when changing password" on hosted, or accept the account-takeover residual in writing.
- [ ] Hosted: the go-live checklist in `docs/ARCHITECTURE.md` §10 (migrations, hook SQL check, dashboard settings, register Claude, deploy, `pnpm connector:smoke`).
- [ ] Hosted: a real connection from Claude, then remove it in Settings and confirm access ends within about a minute.

Acceptance: Claude connects to a publicly reachable instance and answers "what did I spend this month?" from the person's own data only.

### Connector phase 2: everyday writes

- [ ] Transactions, transfers, wallets, categories, budgets, shopping items.
- [ ] Create tools take an optional `requestId`; revision-guarded actions require the `revision` from a read.
- [ ] Deletes, voids and cancels marked destructive; a completeness test fails when a server action is neither a tool nor excluded.

### Connector phase 3: everything else

- [ ] Invoices, loans, installments, fixed expenses, pending payments, salary, currencies, profile.

---

## Later (not scheduled)

Recurring transactions & bills · CSV export/import · savings goals · offline add queue · more accounts / household sharing · receipt photo · quick-entry by text ("taxi 200k").

## Working agreements

- UI work starts with `/impeccable` (global rule). Show a mockup or screenshot before building a new screen.
- Schema changes only via `supabase/migrations/*`; every migration has tests.
- The owner commits manually; Claude does not commit unless asked.
