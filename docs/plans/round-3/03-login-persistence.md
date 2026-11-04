# 30-day Login Persistence Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task after the orchestrator consolidates it. This planning session does not authorize implementation, staging, commits, pushes, migrations, configuration changes, or servers. The owner commits manually.

**Goal:** Preserve a valid login across normal browser restarts and token refreshes for 30 days, while preserving sign-out, recovery, revocation, and tenant isolation.

**Architecture:** Repair the existing Supabase SSR cookie/response lifecycle and use Supabase Auth's native session timebox for duration policy. Keep short-lived verified access JWTs and rotating refresh tokens; browser cookie retention and server session validity are separate concerns.

**Tech stack:** Next.js 16.4.5, next-intl 4.14.9, installed `@supabase/ssr` 0.12.7, Supabase JS 2.118.0, TypeScript, Vitest, Playwright.

**Spec:** Proposed design below, derived from owner item 3 and `PRODUCT.md`, `docs/ARCHITECTURE.md` §§2–3/9, `docs/MOBILE-UX.md` §§1/10/14, `CLAUDE.md`, and `AGENTS.md`. These proposals are not owner-approved decisions.

## Implementation phase evidence (2026-11-04)

The owner's subsequent implementation approval superseded this document's original planning-only header. Parent retains final combined staging/commit/push and root documentation ownership. This session stayed within its auth lease and made no hosted changes or billing changes.

- [x] Repair configured proxy response composition: refresh before next-intl copies request headers; preserve all session chunks/removals plus locale cookies on final auth/locale redirects; retain downstream locale/RSC headers and remove obsolete request-cookie chunks.
- [x] Consume Supabase SSR's second `setAll` cache-header argument. Also mark configured auth decisions private/no-store when no refresh is needed, so an existing-session redirect cannot be shared-cached.
- [x] Mark successful and failed email/recovery confirmation redirects private/no-store, retaining existing server cookie adapter and safe redirect behavior.
- [x] Enable local `[auth.sessions] timebox = "720h"`, with no inactivity limit; retain 3600-second JWT and refresh rotation/reuse settings. Hosted settings remain unapplied and unverified; local stack was not restarted.
- [x] Add 22 passing targeted tests: proxy composition/cache/deletions/locale/basePath/demo cases, email/recovery redirect cache protection, existing safe redirects, and actual installed SSR browser/server cookie serialization, one-hour access session persistence, refresh rotation, and sign-out deletion.
- [x] Add a separate configured-auth browser lane with 390px Chromium/WebKit EN/AR cases, disk-profile browser restart, sign-out followed by restart, concurrent page requests, and action cache-header assertions. It requires a disposable configured app and synthetic confirmed/onboarded account; no demo server is started. Tokens are not saved to traces/storageState/report attachments. Default demo discovery skips these real-auth cases.
- [x] Review targeted diff and run targeted ESLint successfully.
- [ ] Run real configured-auth browser cases, native timebox boundary tests, remote revocation/password-reset integration, HTTPS/sub-path reverse-proxy checks, and physical Safari/PWA restart checks. These require the prepared disposable stack/device/deployment; none is claimed to pass.
- [ ] Parent integration: global typecheck/lint/build, demo E2E, existing RLS SQL tests, and root documentation updates. No schema change is required here.

**Actual successful verification:**

```text
pnpm exec vitest run src/lib/supabase/server.test.ts src/lib/supabase/client.test.ts src/proxy.test.ts src/app/auth/confirm/route.test.ts src/features/auth/redirect.test.ts
# 5 files passed; 22 tests passed.
pnpm exec eslint src/proxy.ts src/proxy.test.ts src/lib/supabase/proxy.ts src/lib/supabase/server.test.ts src/lib/supabase/client.test.ts src/app/auth/confirm/route.ts src/app/auth/confirm/route.test.ts playwright.auth.config.ts e2e/auth-session.spec.ts
# Exit 0, no diagnostics.
pnpm exec playwright test --config=playwright.auth.config.ts --list
# With synthetic list-only environment values: 4 cases discovered; no browser/server launched.
```

The browser list command without required environment values failed as designed with a configuration error naming the missing variables. No actual browser tests ran. Initial regression run failed on lost cookies, stale forwarded cookies, and missing cache headers; after implementation the focused suite passed. A separate no-refresh-cache regression was also observed failing before its fix.

**Rulings/deviations:** Keep the execution record here instead of creating additional skill ledger files, per the file lease. Place proxy adapter/composition coverage together in `src/proxy.test.ts` rather than creating a second adapter suite. Vitest's native loading of next-intl ESM failed on its extensionless `next/server` dependency; unit composition tests therefore model next-intl's documented request-header snapshot. The browser lane exercises real next-intl but is unrun; do not call the unit test a live middleware verification. Browser/server production clients and existing auth actions were left intact because their installed persistent cookie defaults and global sign-out behavior were verified without a demonstrated need to change their interfaces. Installed Next `action-handler.js` sets Server Action responses to no-store; the browser lane asserts actual response behavior once run.

**Requested parent documentation additions:** Explain 30 days from sign-in (720h), not sliding activity; existing cookie retention is 400 days while backend session validity is separate; JWT stays 1h and refresh rotation remains enabled; native timebox enforcement occurs at refresh and can have up to one JWT lifetime of delay. Production hosted Supabase needs its own Auth timebox setting (Pro+ support), no shorter inactivity limit, and no newly enabled single-session policy. Local TOML changes do not configure hosted Auth. Self-hosted Auth deployments, if ever used, need `GOTRUE_SESSIONS_TIMEBOX=720h` on the Auth service, not the Next container. Document the configured browser lane and `AUTH_E2E_BASE_URL`, `AUTH_E2E_EMAIL`, `AUTH_E2E_PASSWORD` for disposable test fixtures only.

## Global constraints

- Preserve 390px mobile-first EN/AR parity, logical RTL utilities, existing Encaustic tile design, `<bdi>` money, and exact integer money math. No visual changes are proposed.
- Preserve demo mode when public Supabase configuration is absent; do not silently switch an invalid real session into demo mode.
- Preserve Server Actions, current zod validation, auth action state types, and the shared `ActionResult<T>` convention for feature mutations. Do not rewrite auth forms solely for this change.
- Keep publishable-key user clients and RLS; never use an admin client under `src/`. Do not read `.env.local`, cookies, tokens, credentials, or real financial data during planning.
- No schema change or migration number is required by the recommended approach. Any later database-backed fallback needs orchestrator coordination and an append-only migration with RLS/SQL tests.
- Local configuration is not hosted configuration. Never claim this feature is live solely because `supabase/config.toml` changed.

## Current implementation and diagnosis

| Current file/interface | Finding and consequence |
| --- | --- |
| `src/lib/supabase/client.ts`: `createClient()` | Calls `createBrowserClient(url, publishableKey)` with defaults. It is currently not imported by a product component. No application-level localStorage/sessionStorage override or intentionally short cookie lifetime was found. |
| `src/lib/supabase/server.ts`: async `createClient()` | Uses `await cookies()`, `getAll`, and `setAll`; swallows cookie-write exceptions for read-only Server Components. Actions and `/auth/confirm` also use it. It does not accept the SSR callback's second `headers` argument. |
| `src/lib/supabase/proxy.ts`: `refreshSession(request, response): Promise<{email: string \| null}>` | Uses `getClaims()` and writes all refreshed cookies to both request and supplied response. Ignores the second `setAll(cookies, headers)` argument containing mandatory cache headers. Discards Auth error details. |
| `src/proxy.ts`: `proxy(request)` | Builds the next-intl response **before** refresh. Both auth redirect branches return a new `NextResponse.redirect`, discarding cookies written to the prior response, including removal cookies. A refresh on a signed-in visit to `/en/sign-in` can rotate tokens but lose the new browser cookie. |
| `src/proxy.ts` / installed next-intl middleware | next-intl copies request headers into its response's upstream header overrides when creating its rewrite/next response. Mutating `request.cookies` afterwards leaves the copied cookie header stale. This is a source-level risk for repeated refresh within one render; reproduce it in the regression suite before claiming it is the deployed logout cause. Next's cookie merging may affect observed runtime behavior. |
| `src/lib/supabase/user.ts`: cached `getUserId(): Promise<string \| null>` | Verifies with `getClaims`, returns `claims.sub`, deduplicates during React rendering. Do not replace with unverified `getSession().user`. |
| `src/features/auth/actions.ts` | `signIn` uses `signInWithPassword`, sign-up requires confirmation, `updatePassword` uses `updateUser`, and `signOut` calls `auth.signOut()` without a scope (SDK default is global). Signing out on another device can therefore explain an unexpected logout here. No app-specific remember-me mechanism exists. |
| `src/app/auth/confirm/route.ts`: `GET(request)` | `verifyOtp` signs in for email/recovery and redirects via `safeNext`/`siteBase`. Cookie mutations use the shared server adapter; auth response cache headers need explicit coverage. |
| `src/features/auth/redirect.ts` and `.test.ts` | Same-site locale redirects are covered. `siteBase` reduces configured URL to origin; advertised sub-path hosting needs a separate end-to-end check and may expose pre-existing callback path defects. |
| `supabase/config.toml` | `jwt_expiry = 3600`, refresh rotation enabled, reuse interval 10 seconds. `[auth.sessions]` and both timeout keys are commented out. No local timebox/inactivity logout is configured. |
| `e2e/auth.spec.ts`, `playwright.config.ts` | Auth E2E tests run with public keys blank. They cover forms and bad confirmation/reset links, not real sign-in, persistence, rotation, session expiry, or sign-out. |
| `README.md`, `PRODUCT.md`, `docs/ARCHITECTURE.md` | Deployment is a self-hosted Next app pointing to **hosted Supabase**, not a self-hosted Auth stack. Architecture covers refresh but has no persistence contract. Some historical `docs/PLAN.md` entries still describe an obsolete owner allowlist; current code/product docs take precedence. |

**Important installed-library evidence:** `node_modules/@supabase/ssr/src/utils/constants.ts` sets persistent cookies to **400 days**, `path: '/'`, `sameSite: 'lax'`, `httpOnly: false`. `src/cookies.ts` deliberately forces successful cookie writes back to its default maxAge, even after spreading custom cookie options; deletion writes use `maxAge: 0`. Thus `cookieOptions: {maxAge: 2592000}` alone is not a reliable 30-day policy in this installed release. Existing cookies should already survive a normal browser restart. Retain library storage/chunk handling rather than patching dependencies or shortening refresh-cookie retention.

**Diagnosis confidence:** Lost cookies on newly constructed redirects and ignored cache headers are concrete defects. Stale upstream cookie forwarding is a concrete ordering concern requiring runtime verification. None proves which event caused the owner's observed logout: no runtime trace, deployment cache behavior, hosted session settings, or account session history was accessed. Other plausible causes are global sign-out on another device, rejected refresh-token reuse, shorter hosted timeouts/single-session enforcement, cookie deletion/private browsing, origin changes, or proxy/CDN stripping/caching cookies. A one-hour JWT expiring is normal and should refresh, not log out a valid refresh session.

## Proposed design/spec

### Duration semantics (assumption for consolidation)

Recommend **30 × 24 hours from session creation/sign-in**, not a calendar month or a sliding renewal on every visit. A successful email confirmation or recovery verification creates its own authenticated session and follows the same backend policy. Password update must not introduce an app timer that silently grants another 30 days to an old session; follow and test Supabase's actual session lifecycle.

| Mechanism | Proposed setting/behavior |
| --- | --- |
| Persistent browser auth cookie | Keep SSR defaults, retaining refresh credentials across ordinary browser restarts. Its retention is not permission to stay logged in after server session expiry. |
| Access JWT | Keep 3600 seconds (one hour); verify signature and expiry. Never extend to 30 days. |
| Refresh token | Keep rotation on and existing 10-second reuse interval; never disable validation/rotation to hide a refresh race. |
| Absolute session lifetime | Native Supabase timebox **720 hours**. Refresh does not restart the original session age. |
| Inactivity timeout | No shorter inactivity timeout; leave unset for this proposed absolute policy. A session returning on day 29 can refresh even after a long absence. |
| Concurrent devices | Preserve multiple sessions; do not enable single-session enforcement as part of this item. Preserve existing global sign-out behavior pending consolidated product decision. |

Supabase enforces timebox/inactivity at refresh, so an already-issued JWT can remain usable beyond 720 hours until its one-hour lifetime ends. Acceptance is a **30-day refresh session with up to one JWT lifetime of enforcement delay**, not an exact-to-the-second cutoff. Existing `getClaims()` authorization does not immediately detect remote revocation of an otherwise valid JWT. Revoked refresh sessions must fail on next refresh; no cookie or retry fallback may resurrect them. Immediate revocation/exact cutoff would be a separate stronger requirement involving server-side session validation and potentially database enforcement, not a client timestamp.

No remember-me checkbox, countdown, or new login UI is needed. Retain safe locale redirects, confirmation checks, Turnstile behavior, and generic credential errors. Do not promise persistence if the user deletes storage or uses private browsing.

### Configuration environments and alternatives

1. **Hosted production (recommended):** Configure Time-box user sessions in the hosted project's Auth session settings to the equivalent of **720 hours**, with no shorter inactivity timeout and single-session enforcement disabled. Native session limits require **Pro or above** in the current official docs. Record the effective hosted setting and account tier without exporting secrets. Do not automatically upgrade billing or change hosted settings during this planning session.
2. **Local CLI:** Enable `[auth.sessions]` with `timebox = "720h"`; leave `inactivity_timeout` unset and retain JWT/rotation settings. Restart a disposable local stack when executing; a database migration or app rebuild does not apply this setting to hosted Auth.
3. **Actually self-hosted Supabase Auth (only if deployment changes):** Official Docker configuration documents `GOTRUE_SESSIONS_TIMEBOX` and `GOTRUE_SESSIONS_INACTIVITY_TIMEOUT`. Set the timebox to `720h` in the deployed Auth service environment and restart/redeploy that service; verify its actual image/version supports the settings. Merely adding a Next container env var is ineffective. Preserve refresh rotation and one-hour JWT settings in Auth itself.
4. **If hosted tier lacks native limits:** Cookie/refresh reliability repairs still improve persistence, but cannot honestly enforce a 30-day absolute server session cap. Recommend native supported configuration rather than a custom auth/session database. Do not silently market an indefinite session as a 30-day session. A fallback decision belongs in orchestrator consolidation before claiming full delivery.
5. **Sliding alternative:** No absolute timebox plus `inactivity_timeout = "720h"` permits active sessions indefinitely; background token refresh counts as activity. This is a materially different promise. Do not implement it unless the consolidated requirement selects 30 days since last refresh/activity.

### Response composition and security

Retain `refreshSession(request, response)` as the low-level adapter. In configured mode, create a temporary session response, refresh once (updating request cookies), **then** create the next-intl response from the updated request. Pick the final locale/auth redirect or rewrite, and copy all session cookies and only the designated cache-protection headers onto that final response. Preserve next-intl locale cookies, rewrite target, locale request header, links, and RSC headers; do not copy all transport headers from a temporary `NextResponse.next()` onto a redirect/rewrite. Demo mode still directly returns next-intl output without constructing a Supabase client.

Implement both parameters of `setAll(cookiesToSet, headers)` in the proxy adapter. Use `response.cookies.set(cookie)`/iteration to preserve all options, multiple chunks, and zero-age removal entries; never split `Set-Cookie` on commas. Server Actions and Route Handlers need equivalent cache safety without attempting mutable response headers from a Server Component. Explicitly mark confirmation/recovery redirect responses private/no-store and verify actual Server Action HTTP responses retain no-store behavior. Retain read-only Server Component cookie-write tolerance, but do not add broader catches that hide action/handler persistence failures.

No money writes, schema transactions, RLS policy changes, or SQL migrations are needed. Refresh atomicity is supplied by Auth token rotation; this app must deliver the rotated pair in the same final response and downstream request. Test parallel requests rather than widening reuse intervals. Never log cookie values, Authorization headers, passwords, token hashes, or financial data. No shared client singleton on the server; the existing browser singleton behavior stays intact. Cookies remain browser-readable as required by SSR's browser client; do not apply a generic HttpOnly policy that breaks it. Production HTTPS and host/path/SameSite consistency must be checked behind the real reverse proxy.

## Review focus

1. Refresh during auth redirect loses the only current refresh token: final redirect must carry every changed/deleted cookie (Task 1).
2. Server render sees pre-refresh cookies and refreshes again: next-intl upstream Cookie header must contain the refreshed pair (Tasks 1/3).
3. Restart or several days idle looks like logout: persistent cookie plus valid Auth refresh must resume without credentials (Tasks 2/3).
4. A removed/revoked session appears to return: removal cookies survive redirects and refresh refusal never falls back to stored claims (Tasks 1/3).
5. CDN caches a refreshed user's session or a recovery redirect: no-store headers survive final response selection (Tasks 1/3).

## Implementation tasks (future work; none performed here)

### Task 1: Repair SSR response propagation

**Files:** Modify `src/lib/supabase/proxy.ts`, `src/proxy.ts`, and cache behavior in `src/app/auth/confirm/route.ts`; inspect `src/lib/supabase/server.ts` without unnecessary restructuring. Create `src/lib/supabase/proxy.test.ts`, `src/proxy.test.ts`, `src/app/auth/confirm/route.test.ts`.

**Interfaces:** Keep `supabaseConfigured(): boolean`, `refreshSession(request: NextRequest, response: NextResponse): Promise<{email: string | null}>`, server/browser `createClient()` APIs, auth action types, `safeNext`, and `siteBase`. Add `copySessionResponse(source: NextResponse, target: NextResponse): NextResponse` in `src/lib/supabase/proxy.ts`, copying cookies and `cache-control`, `expires`, `pragma` only. Call it once after final response selection.

- [ ] Write regression tests using actual `NextRequest`/`NextResponse`, mocked Auth SDK invocation, and actual next-intl response creation where feasible. A `TOKEN_REFRESHED` cookie batch on `/en/sign-in` and `/ar/sign-in` must survive the signed-in redirect; an invalid-session batch with `maxAge: 0` must survive the signed-out redirect.
- [ ] Assert every numbered cookie chunk and its options survives; existing next-intl locale cookies remain; all three cache headers reach the final response. Assert the downstream `x-middleware-request-cookie` header contains refreshed values and the locale override remains. Assert auth refresh occurs once, before locale response construction.
- [ ] Assert demo mode never constructs Auth clients; locale-only redirect behavior, `/auth/confirm` exclusion, `/en/reset-password` protection, and safe same-site redirects remain correct. Use both locales and nonempty `basePath` in composition tests; do not blanket-copy internal next/redirect headers.
- [ ] Run `pnpm exec vitest run src/lib/supabase/proxy.test.ts src/proxy.test.ts src/app/auth/confirm/route.test.ts`; record the expected regression failures before fixing.
- [ ] Apply the composition and header changes described above. Explicitly mark confirmation/recovery redirect responses private/no-store while retaining cookies written through `await cookies()`. Do not set response headers through `headers()` inside a Server Component.
- [ ] Rerun the same tests; expect all cases to pass. If Next runtime cookie merging makes one stale-header assertion differ, retain the user-facing integration test and correct the diagnosis, not token security settings.

### Task 2: Define and document the effective 30-day Auth policy

**Files:** Modify `supabase/config.toml`, `README.md`, `docs/ARCHITECTURE.md` §3. No dependency or schema changes. `src/lib/supabase/client.ts` and `server.ts` retain aligned storage defaults; no maxAge-only override.

**Interfaces:** Local `[auth.sessions].timebox = "720h"`; hosted Auth's Time-box user sessions setting with equivalent duration; self-hosted Auth `GOTRUE_SESSIONS_TIMEBOX=720h` only where applicable. JWT remains 3600 seconds; rotation remains enabled, reuse interval 10 seconds.

- [ ] Consolidate the absolute/sliding assumption, hosted feature availability, and accepted JWT enforcement delay before final policy implementation. Treat missing hosted support as an explicit delivery dependency, not as implicit permission to spend money.
- [ ] Apply local 720-hour timebox and document separate hosted setup instructions, Pro+ requirement, inactivity and single-session settings, and an optional self-hosted Auth note. Explain ordinary restart, storage deletion, sign-out, and the JWT grace interval in deployment docs.
- [ ] On execution, verify the local CLI accepts the config by starting/restarting a disposable stack. Record actual hosted session settings separately if authorized/configured; no `db push` claim substitutes for hosted setting verification.
- [ ] Test the boundary in an isolated Auth environment with a shortened timebox and normal JWT expiry; use real Auth time or fixture session metadata controlled outside product code. Browser clock mocking alone cannot advance the Auth server clock. Restore test settings afterward and never mutate production `auth.sessions` to simulate age.
- [ ] Confirm effective production policy does not reject refresh before day 30 for inactivity and that refresh after the absolute timebox is refused. A previously issued JWT may remain usable until its expiry; do not assert an instantaneous logout at 720 hours.

### Task 3: Add a real-session verification lane

**Files:** Create `playwright.auth.config.ts` and `e2e/auth-session.spec.ts`; retain existing `playwright.config.ts` demo lane and `e2e/auth.spec.ts`. Add adapter tests in `src/lib/supabase/server.test.ts` and `src/lib/supabase/client.test.ts` as needed. Add action regression coverage in `src/features/auth/actions.test.ts` only for the session behaviors below.

**Interfaces:** Separate auth Playwright config targets a disposable configured local/staging app using `AUTH_E2E_BASE_URL` and synthetic confirmed test accounts. It must not blank the public Supabase settings or reuse the demo webServer. Spec files fail clearly when explicitly invoked without the required test environment. Keep credentials in ephemeral test environment inputs; do not commit storageState files. Use public-key user sessions for assertions; any fixture administration stays test-only and outside `src/`.

- [ ] Verify adapter behavior with installed SSR serialization, not just hardcoded options: successful session cookies are persistent, browser/server cookie encoding/name/path are consistent, chunk removal preserves `maxAge: 0`, and no localStorage or HttpOnly change breaks browser refresh. A server-render cookie write is tolerated only in a read-only render context; action and Route Handler writes actually arrive in the browser.
- [ ] Real sign-in in EN and AR at 390×844: navigate, refresh, close/relaunch the browser with a test-only persistent profile, and return to a protected page. Require actual cookie expiry metadata beyond 30 days and retained authentication. Merely reloading or replaying storageState is insufficient to claim browser-restart coverage. Cover Chromium and WebKit where profile persistence is supported; document a real-device Safari/PWA restart check otherwise.
- [ ] Start with a valid refresh token and naturally expired/near-expiry access JWT in a disposable test environment. Open a protected page and then a public auth page; assert new cookies are delivered, redirect succeeds, and the following Server Component data request succeeds without a second credential prompt. Do not forge an unsigned access token to test refresh.
- [ ] Open two tabs/parallel protected requests around refresh and resume after sleep/background. Assert the final saved session remains usable; no invalid-token loop. Distinguish network/5xx interruption from permanent Auth rejection: retrying a recoverable failure must not erase a still-valid refresh token or grant access from unverified claims.
- [ ] Sign out using the existing action: local cookie chunks disappear and reopening the profile cannot regain the session. Verify the currently global scope ends other refresh sessions too. Assert revoked/expired refresh token rejection clears stale browser state and reaches localized sign-in; an unexpired JWT's documented revocation delay is tested separately, not misrepresented as immediate revocation.
- [ ] Follow real email-confirmation/recovery links with synthetic users, verify cookies survive `/auth/confirm` redirects, update the password, and test old-password rejection/new-password sign-in and actual other-session revocation behavior. Do not assume password update revokes every JWT immediately. Keep expired/reused token and external-redirect rejection coverage.
- [ ] Exercise configured root and sub-path deployments behind HTTPS/reverse proxy: cookies sent on the intended routes, refresh/confirmation redirects use the public origin, and auth/refresh responses carry private/no-store protections. Inspect HTTP headers without saving raw token-bearing responses to reports. Track pre-existing sub-path defects explicitly if these block the flow.
- [ ] Verify user A still cannot read/write user B data with retained sessions; existing `supabase/tests/isolation.test.sql` remains the database check. Session duration must never broaden RLS access.

## Planned verification commands and completion evidence

Run during implementation (not this planning turn):

```text
pnpm typecheck
pnpm lint
pnpm exec vitest run src/lib/supabase/proxy.test.ts src/proxy.test.ts src/app/auth/confirm/route.test.ts src/lib/supabase/server.test.ts src/lib/supabase/client.test.ts src/features/auth/actions.test.ts src/features/auth/redirect.test.ts src/messages/messages.test.ts
pnpm exec playwright test e2e/auth.spec.ts --project=iphone --project=android
pnpm exec playwright test --config=playwright.auth.config.ts e2e/auth-session.spec.ts
pnpm exec supabase test db supabase/tests/isolation.test.sql
pnpm build
```

The future auth config must define EN/AR cases explicitly and 390px WebKit/Chromium projects; the current project names alone do not imply both locales. Run real-session checks against a prepared disposable stack with synthetic accounts. Database checks need that stack and applied existing migrations. Build verifies standalone compatibility. Review EN/AR login/recovery screens at 390px; full mobile Definition of Done applies if implementation introduces any UI/copy changes. Preserve the existing demo auth lane. Record passes, failures, skipped checks, effective local/hosted policy, and unresolved deployment limitations separately; do not claim a 30-day production outcome from mocked unit tests.

**Actually performed here:** Read-only repository/installed-package investigation, official documentation lookup, and writing this plan. No product code/config/dependencies changed, no product tests/build/lint/typecheck run, no server started, no secrets accessed, no migration/staging/commit/push performed.

## Dependencies, shared files, and consequential decisions

- Orchestrator owns consolidation and `docs/plans/round-3/README.md`. Coordinate modifications to `src/proxy.ts`, shared Supabase clients, auth actions/confirm route, `README.md`, `docs/ARCHITECTURE.md`, and any shared test setup with other items before execution.
- Preferred path introduces no DB migration or RLS change. If a custom session-enforcement fallback is selected later, obtain a fresh migration number from the orchestrator and plan Auth/session authorization and atomic enforcement separately.
- Material decisions for consolidation: (1) accept 30 days from sign-in versus sliding inactivity; (2) confirm hosted Pro+ native support or select an explicit alternative; (3) accept refresh-time enforcement with up to one-hour JWT delay versus a stronger immediate cutoff/revocation contract; (4) retain existing global sign-out versus intentionally switch to current-device sign-out. Recommended defaults are absolute 720h, native backend support, documented JWT delay, and preserved existing global scope.
- Operational uncertainty: exact deployed logout trigger and hosted settings remain unverified. Complete the targeted runtime diagnosis before declaring the refresh fixes explain the owner's symptom.

## Official references checked

- [Supabase user sessions](https://supabase.com/docs/guides/auth/sessions): native session timebox/inactivity, hosted Pro+ availability, refresh-time enforcement, one-hour JWT guidance.
- [Supabase SSR client setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client?environment=client-component): verified claims, request/response refresh propagation, copying cookies/cache headers when replacing a response.
- [Supabase advanced SSR guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide): cookie lifetime is separate from session validity, global sign-out, revocation caveat, cache safety.
- [Supabase CLI config](https://supabase.com/docs/guides/local-development/cli/config): local-only settings/restart and `auth.sessions.timebox` / `inactivity_timeout`.
- [Supabase Docker Auth settings](https://github.com/supabase/supabase/blob/master/docker/CONFIG.md): self-hosted Auth session environment variable names.
- Installed Next.js guides read: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`, `01-app/03-api-reference/03-file-conventions/proxy.md`, and applicable auth sections of `01-app/02-guides/authentication.md`. They establish async cookies, writable action/handler boundaries, proxy response headers, and independent action authorization.
