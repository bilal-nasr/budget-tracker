# MCP connector for Budget Tracker: design

Date: 2026-11-24. Status: awaiting owner approval.

## 1. Intent

The owner wants to run the app by talking to Claude: "add a 12 dollar lunch from my cash wallet", "what is left in groceries this month", "mark these invoice rows paid". Claude should be able to do everything a signed-in person can do in the app, from the Claude phone app, web and desktop, and every account holder should be able to connect their own account.

## 2. Goals, non-goals, anti-goals

**Goals**

- A remote MCP endpoint served by the app itself, added in Claude as a custom connector by URL.
- Each person signs in with their Budget Tracker account and approves Claude once. Claude then acts as that person and sees only their data.
- Every app action and every page-level read is available as a tool, apart from the exclusions in §6.3.
- The connector uses the same validation, database rules, revision checks and Undo behaviour as the app.
- A change made through Claude shows up in the open app the same way a change from another tab does today: on the next navigation or refresh (`revalidatePath`), and live only in invoice folders, which already listen to the database. Live updates on other screens are not part of this work. (Builder's call.)

**Non-goals (v1)**

- A local (stdio) server or personal access tokens.
- Tools for sign-in, sign-up, password, passkeys or sign-out.
- File export (the Excel export route) through the connector.
- MCP resources, prompts or elicitation. Tools only.
- A listing in Anthropic's public connector directory.

**Anti-goals (these would make it a failure even if it works)**

- One account reading or changing another account's data through the connector.
- A second copy of money rules that can drift from the app's.
- The secret key appearing anywhere under `src/`.
- Mixing currencies, or amounts reaching the database through any path other than `src/lib/money.ts`.
- A connector request silently acting on a browser cookie session.

## 3. Constraints

- Project rules in `CLAUDE.md` apply: RLS with the publishable key and the user's session, zod validation, minor units, platform-neutral hosting (`output: "standalone"`, optional `basePath`, Docker), no host-specific APIs.
- The app is self-hosted behind HTTPS. Claude's servers must be able to reach the endpoint from the internet.
- Sign-up is open, so the endpoint is public and must reject everything without a valid token.
- Any new screen follows the UI process: `impeccable` skill, mockup for the owner before the full build, EN + AR strings, 390px first.
- The owner commits manually. Nothing in this work runs `git commit`.

## 4. Approaches considered

| | Approach | Trade-off |
| --- | --- | --- |
| A (chosen) | Tools call the existing Server Actions and queries. A change to how the Supabase client is created lets it use Claude's token instead of cookies (plus the few call sites listed in §6.2). | Smallest new surface; rules exist once. Depends on action files being callable from a Route Handler (they are plain async functions; none of the non-auth actions redirect). |
| B | A separate connector layer with its own database calls. | Decoupled from Next.js, but every rule is written twice and will drift. Rejected: anti-goal. |
| C | A few generic table read/write tools over the Supabase API with the user's token. | Very little code, but skips zod validation and the action-level checks, and Claude must guess the data model. Rejected. |

Sign-in: Supabase Auth's OAuth 2.1 server (chosen) against building our own token issuing. Supabase's is standard, ~~supports dynamic client registration that Claude needs,~~ and its tokens carry the user's id so existing RLS applies. **Superseded 2026-11-24 by §9 (owner decision): dynamic client registration is off; the owner registers Claude with `pnpm connector:register` and pastes its app id into Claude.** `supabase/config.toml` already has the `[auth.oauth_server]` block, switched off. This is the builder's call, not something the owner decided in detail.

## 5. How it works

```
Claude ──HTTPS──> <site>/mcp  (Route Handler)
                    │ 1. read "Authorization: Bearer <token>"; none/invalid → 401 + pointer to sign-in metadata
                    │ 2. verify token with Supabase (getClaims), get user id
                    │ 3. run the tool inside a request context holding the token
                    ▼
            existing action / query  ──>  createClient()  ──>  Supabase (RLS as that user)
```

First connection: Claude reads the endpoint's metadata, ~~registers itself with Supabase,~~ and sends the person to Supabase's authorize address. **Superseded 2026-11-24 by §9: Claude does not register itself; it uses the app id the owner registered and the person pasted into Claude's advanced settings.** Supabase redirects to the app's consent screen. The person signs in if needed, sees "Allow Claude to use your Budget Tracker account?", and approves. Claude receives tokens and refreshes them itself.

## 6. Design

### 6.1 Endpoint

- `src/app/mcp/route.ts`, outside `[locale]` like `/auth/confirm`. The proxy matcher (`/`, `/(en|ar)/:path*`) does not touch it, so no cookie session logic runs.
- Stateless Streamable HTTP. No server-side session store, so it works on a single Node process or several.
- Metadata route for protected-resource discovery (RFC 9728) naming the Supabase project as the authorization server. The 401 response's `WWW-Authenticate` header carries the full metadata URL, built the way the rest of the app builds public addresses: origin from `siteBase(NEXT_PUBLIC_SITE_URL)` (`src/features/auth/redirect.ts`) plus `NEXT_PUBLIC_BASE_PATH`.
- Production is served at the root of its own subdomain, with no base path, so root hosting is what gets tested. Addresses are still built with the base path so sub-path hosting is not broken on purpose, but discovery under a sub-path (which may need a reverse-proxy rule for `/.well-known/…` at the host root) is documented as untested, not solved. (Builder's call.)
- Library: the official MCP TypeScript SDK or `mcp-handler`. Builder chooses after reading current docs, pins the version, and confirms it runs on plain Node with no host-specific dependency.

### 6.2 Identity

- New file `src/lib/supabase/request-context.ts`: an `AsyncLocalStorage` holding `{ accessToken, userId }` for the duration of one connector request.
- `createClient()` in `src/lib/supabase/server.ts`: if a connector context exists, return a Supabase client that sends that token and has no cookie access at all. Otherwise behave exactly as today.
- `getUserId()` in `src/lib/supabase/user.ts`: if a connector context exists, return its `userId`. It is wrapped in React `cache`; the builder must prove with a test that two connector requests for different users never share a cached value.
- Token check: `supabase.auth.getClaims(token)`; require a `sub` and the `authenticated` role. A request with a bad or missing token never falls through to cookies.
- Call sites that ask Supabase Auth for the user without going through `getUserId()` must also work in a connector request. Known one: `buildSalaryEmail` in `src/features/salary/email/summary.ts` calls `supabase.auth.getUser()`; without a fix, a salary recorded through Claude would send no email. The builder greps for `auth.getUser(` / `auth.getSession(` under `src/features` and routes each through the context.
- Known limitation, accepted: Supabase's tokens are not bound to this endpoint's address by default. They are only usable against this Supabase project, whose RLS already limits them to the person's own data.

### 6.3 Tools

- One tool per action or read, named `<area>_<verb>` (for example `transactions_create`, `wallets_list`, `invoices_pay_items`). Roughly 80 write tools and 20 read tools.
- Each feature gets `src/features/<feature>/mcp.ts` that declares its tools: name, English description for Claude, zod input shape, and a handler that calls the existing action or query. A central `src/lib/mcp/registry.ts` collects them.
- **Excluded:** everything in `features/auth` and `features/passkeys`, `saveLocale` and `completeOnboarding` (app-screen concerns), and the export route.
- **Completeness test:** a unit test lists every exported function in every `"use server"` file under `src/features` (not only `actions.ts`: there are also `bulk-actions.ts`, `cycle-actions.ts` and `history-actions.ts` files) and fails unless each one is either registered as a tool or named in an explicit exclusion list. This keeps "all actions" true as the app grows.
- **Month summary:** today it is assembled inside the Home page (`src/app/[locale]/(app)/page.tsx`) and follows the salary cycle, not the calendar month. It is extracted into a query the page and the tool both call, and the tool returns both the current salary cycle and the calendar month, each labelled with its dates, so "this month" is never ambiguous.
- **Reads:** wallets with balances, activity (filters and cursor), month summary and budgets, categories, currencies, fixed expenses, installments, loans and loan history, pending payments and receipts, salary status, shopping items, invoice folders and one folder, profile.
- **Hints:** read tools are marked read-only. Deletes, voids, cancels, wallet settle-and-delete, member removal and share-link rotation are marked destructive so Claude asks first.
- **Money:** tools accept amounts as a decimal string plus a currency code (`"12.50"`, `"USD"`) and convert through `src/lib/money.ts`. Results return both the minor-unit integer and a formatted string. No tool adds or compares different currencies; totals come back per currency.
- **Retries and Undo:** create tools take an optional `requestId` (UUID) and generate one when absent, mapping to the existing draft/request id contracts. Where the underlying action takes an expected revision (transactions, loan payments, pending payments), the tool requires the `revision` returned by a read or a previous write; other tools take exactly what their action takes and no more. Delete results include what is needed to call the matching restore tool.
- **Errors:** the existing `ActionError` codes map to one plain English sentence each (single table in `src/lib/mcp/errors.ts`) and return as tool errors. Unknown database text never reaches Claude, same as the app.
- Tool names and descriptions are English only; they are read by the model, not shown in the app.

### 6.4 Consent screen

- Supabase redirects to a fixed path (`/oauth/consent?authorization_id=…`). A small Route Handler there forwards to `/[locale]/connect?authorization_id=…` using the profile or browser locale.
- Returning after sign-in has to be built: `signIn` only goes home or to a remembered share link, and `safeNext` drops query strings. A signed-out visitor's `authorization_id` is remembered the way a share link is (the `pending-join` cookie pattern) and honoured after password sign-in, sign-in key sign-in, and sign-up followed by email confirmation.
- ~~Any MCP client may register.~~ **Superseded 2026-11-24 by §9 (owner decision): only approved apps may connect; self-registration is off.** The screen still shows the name as claimed plus the web address the approval will be sent to.
- The screen shows which app is asking, that it will be able to see the person's budget data (owner-approved wording while apps are read-only; restore "change" when writes ship), and Allow / Deny. It uses `supabase.auth.oauth.getAuthorizationDetails`, `approveAuthorization`, `denyAuthorization`.
- New screen: `impeccable` first, mockup to the owner before the full build, EN + AR strings, 390px screenshots.

### 6.5 Disconnecting

- Settings gains a "Connected apps" row listing approved apps with a Remove button, if Supabase exposes listing and revoking grants to the signed-in user. Builder verifies; if it does not, v1 documents how the owner revokes from the Supabase dashboard and this moves to a follow-up.

### 6.6 Tests

- Unit: request-context isolation (bearer never mixes with cookies; no cross-request leak), money conversion at the tool boundary, error table covers every `ActionError`, the completeness test.
- Integration against the local stack: an MCP client script signs in as two seed users, lists tools, creates an expense, reads it back, and confirms the second user cannot see or change it.
- E2E (Playwright): the consent screen in EN and AR on the mobile projects.
- Manual: connect from Claude to a publicly reachable instance and run one read and one write.

### 6.7 Owner setup (hosted Supabase)

Written into `docs/ARCHITECTURE.md` §10 as the hosted go-live checklist (superseded by §9: dynamic registration stays off and the owner registers Claude with `pnpm connector:register`). 

**Go/no-go check, first task of Phase 1:** before any other code, the builder confirms with the owner that the hosted project can turn the OAuth server on (plan availability, asymmetric signing keys if required). If it cannot, work stops and comes back to the owner; there is no approved fallback.

## 7. Phases

1. **Foundation:** endpoint, identity seam, sign-in and consent screen, all read tools. Done when Claude can connect and answer "what did I spend this month?".
2. **Everyday writes:** transactions, transfers, wallets, categories, budgets, shopping items.
3. **Everything else:** invoices, loans, installments, fixed expenses, pending payments, salary, currencies, profile; Connected apps; docs (`ARCHITECTURE.md`, `PLAN.md`, `.env.example`).

## 8. Left to the builder

- Library choice and version (§6.1).
- Exact tool names, descriptions and input shapes, guided by each feature's existing zod schema.
- How `expectedUnits` (the currency-intent header used by some actions) is surfaced in tool inputs.
- Whether very large read results are paged or trimmed, following the app's 30-row cursor pages.

## 9. Hardening before going live (added 2026-11-24)

**Why.** Phase 1's verification showed that a token issued to a connected app is a full Supabase user token: on the local stack it changed the account's password, started an email change, and can call the database API directly under RLS. Supabase's docs confirm that OAuth scopes do not limit database access and that the database is where a client's access is limited (the token carries `client_id`). The read-only tools therefore limit what the assistant is offered, not what the token holder can do.

**Owner decision.** Only Claude may connect. Self-registration (dynamic client registration) is off.

**Goals**

- A connected app's token can only read, enforced in the database for tables and for every function, whatever path the request takes.
- Only apps the owner registered can obtain or use a token.
- A connected app's token cannot change the account's password, or the limit of what can be done about that is tested and written down.
- A person can see and remove the apps they approved.

**Non-goals.** Write access for connected apps (Phases 2 and 3 open specific writes deliberately). Replacing Supabase's OAuth server with our own token issuing.

**Approaches considered**

| | Approach | Trade-off |
| --- | --- | --- |
| A (chosen) | One database-side request guard (PostgREST `db_pre_request`) that inspects the token's `client_id` on every API request: unknown client → refused; known client → reads only. An allowlist table is the single source of truth, also read by `/mcp`. | One place covers 22 tables and ~76 `security definer` functions. Depends on the pre-request hook being available on hosted Supabase; verified first, with a fallback. |
| B | `AS RESTRICTIVE` RLS policies on every table plus a guard call added to every `security definer` function. | Works everywhere, but touches every function and is easy to miss on the next one. Fallback only. |
| C | Stop forwarding Supabase tokens: issue our own connector tokens and use a privileged server path. | Strongest separation, but needs the secret key under `src/` and a second authorization server. Rejected. |

**Design**

- Table `public.connector_clients (client_id text primary key, name text not null, created_at timestamptz not null default now())`. Readable by `authenticated`; written only with the secret key by a script.
- Function `public.connector_request_guard()` set as the API pre-request hook. No `client_id` claim → allowed (ordinary session). `client_id` not in `connector_clients` → refused. Otherwise allowed only for reads: `GET`/`HEAD` on tables and views, and calls to the read functions on an explicit allowlist (built this way: volatility labels are not trusted); the request also runs in a read-only transaction. For an app token the guard additionally requires a live `auth.sessions` row of the same person and app, so removing the app cuts its token off at once.
- `/mcp` accepts a token only if its `client_id` is in `connector_clients`. Ordinary session tokens are accepted only when `MCP_ALLOW_SESSION_TOKENS=1` (local testing).
- `supabase/config.toml`: `allow_dynamic_registration = false`, `secure_password_change = true`. `double_confirm_changes` is already `true`.
- `pnpm connector:register` registers a public OAuth client (PKCE, no secret) with the redirect address `https://claude.ai/api/mcp/auth_callback` and records it in `connector_clients`.
- Settings gains "Connected apps": the apps this person approved, each with Remove (`supabase.auth.oauth.listGrants()` / `revokeGrant()`), and a "Connect Claude" help block showing the connector address and the app id to paste into Claude. The consent screen gets its "You can remove its access later in Settings." line back.
- Accepted and documented: an authorization link nobody has opened yet can be approved by the first signed-in account that opens it; the link only travels to the connecting person's browser.

**Left to the builder.** Whether Phase 2 opens writes per function or per client; exact layout of the Settings block (mockup first).
