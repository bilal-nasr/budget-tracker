# MCP Connector Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before the connector goes live, make a connected app's token read-only in the database, allow only apps the owner registered, protect password changes, and let people remove apps they approved.

**Architecture:** One database-side request guard (PostgREST pre-request hook) reads the token's `client_id` on every API request and enforces "unknown app: nothing; known app: reads only", using an allowlist table that `/mcp` also checks. Self-registration is switched off and one client is registered for Claude by script. A Settings block lists and revokes grants through Supabase's own API.

**Tech Stack:** Postgres/PostgREST (Supabase), SQL tests (pgTAP via `supabase test db`), Next.js 16, `@supabase/supabase-js` `auth.oauth` grant API, existing `scripts/test-mcp.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-24-mcp-connector-design.md` §9 (and §6 for context). Builds on `docs/superpowers/plans/2026-11-24-mcp-connector-phase-1.md`, which is complete on branch `feat/mcp-connector`.

## Global Constraints

- **No `git commit`, `git add` or push in any task.** The owner commits manually. A task ends when its tests, `pnpm typecheck` and `pnpm lint` pass.
- Schema changes only through `supabase/migrations/` (next file: `20261209000000_…`), each with a SQL test in `supabase/tests/`.
- The secret key (`SUPABASE_SECRET_KEY`) is never imported under `src/`. Scripts under `scripts/` may use it.
- Never touch a hosted Supabase project. `.env.local` points at one: never edit or print it; local runs take keys from `pnpm exec supabase status -o env`.
- Ordinary browser sessions (no `client_id` claim) must behave exactly as today: the full existing SQL test suite (`pnpm db:test`) and unit suite stay green.
- A connector request never reads or writes cookies.
- Every user-visible string in both `src/messages/en.json` and `src/messages/ar.json` in the same change. UI work: invoke the `impeccable` skill first; logical Tailwind utilities only; 390px first; touch targets ≥ 44px; `<bdi>` around names and addresses; screenshots at 390px EN and AR.
- Exact values: table `public.connector_clients`; function `public.connector_request_guard()`; Claude's redirect address `https://claude.ai/api/mcp/auth_callback`; env `MCP_ALLOW_SESSION_TOKENS`; npm script `connector:register`.

## Review Focus

1. A token from an app that is **not** in `connector_clients` → every API request refused (tables, views, functions), and `/mcp` answers 401. (Tasks 1, 2)
2. A token from a registered app calling a **`security definer` write function** directly (for example `save_transaction`, `create_wallet`) → refused; the row is not written. (Task 1)
3. An ordinary signed-in browser session → every existing read and write still works; no new latency-visible failure. (Task 1)
4. A person with **no** approved apps, or whose grant list fails to load → Settings shows an empty or plain error state, never a crash; Remove on an already-removed app is harmless. (Task 4)
5. After Remove, the app's existing access token → rejected by `/mcp` and the database on its next use, or the exact remaining lifetime is measured and written down. (Tasks 3, 4)

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20261209000000_connector_read_only.sql` (new) | Allowlist table, request guard, hook registration |
| `supabase/tests/connector_read_only.test.sql` (new) | Guard behaviour for session, unknown app, known app |
| `src/lib/mcp/clients.ts` (new) | `isAllowedClient(clientId)` with a short cache |
| `src/lib/mcp/auth.ts`, `src/app/mcp/route.ts` (modify) | Enforce the allowlist at `/mcp` |
| `scripts/register-connector-client.mjs` (new) | Register an OAuth client and record it |
| `scripts/test-mcp.mjs` (modify) | OAuth-issued token checks, direct-write attempts, revoke |
| `supabase/config.toml` (modify) | Registration off, secure password change on |
| `src/features/connect/grants.ts`, `actions.ts` (new/modify) | List and revoke grants |
| `src/app/[locale]/(app)/settings/connected-apps-section.tsx` (new) | Settings block |

---

### Task 1: Database guard

**Files:**
- Create: `supabase/migrations/20261209000000_connector_read_only.sql`, `supabase/tests/connector_read_only.test.sql`
- Modify: `docs/ARCHITECTURE.md` (§10, one paragraph)

**Interfaces:**
- Produces: table `public.connector_clients (client_id text primary key, name text not null, created_at timestamptz not null default now())`, RLS on, `select` for `authenticated`, no insert/update/delete policy; function `public.connector_request_guard() returns void`; raises SQLSTATE `42501` with message `connector.forbidden` when it refuses.

- [ ] **Step 1: Prove the hook works here before building on it.** On the local stack, in a scratch SQL session (not a migration), create a trivial function that raises, set it with `alter role authenticator set pgrst.db_pre_request = 'public.<fn>'` followed by `notify pgrst, 'reload config'`, and confirm an API request fails; then remove it. Search Supabase's docs (pre-request / `db_pre_request`) to confirm it is supported on hosted projects and how it is set there. Record both results. **If the hook is unavailable locally or unsupported on hosted, stop and report:** the fallback is spec §9 approach B and needs a revised task.
- [ ] **Step 2: Establish the read-function rule.** List every function the Phase 1 read tools call through the API (grep `.rpc(` under `src/features/*/queries.ts`, `cycle-queries.ts`, `summary.ts` and anything they import) and look up each one's volatility (`select proname, provolatile from pg_proc …`). If all are `stable`/`immutable`, the guard's rule is "functions that are not volatile". If any is `volatile`, the guard uses an explicit allowlist array of exactly those read function names instead. Record the list and the choice in the migration's header comment.
- [ ] **Step 3: Write the failing SQL test** `connector_read_only.test.sql` (pgTAP, same style as `supabase/tests/isolation.test.sql`: set `request.jwt.claims`, `request.method`, `request.path`, then call the guard and the statement). Cases:

```sql
-- session token (no client_id): guard passes for GET, POST, PATCH, DELETE and rpc
-- unknown app (client_id not in connector_clients): guard raises 42501 'connector.forbidden' for GET /wallets, POST /rpc/<a read fn>, POST /transactions
-- known app: GET /wallets and HEAD /transactions pass
-- known app: POST /transactions, PATCH /wallets, DELETE /categories raise
-- known app: POST /rpc/<each read function from Step 2> passes
-- known app: POST /rpc/save_transaction and POST /rpc/create_wallet raise   (security definer writes)
-- known app: a request whose path is malformed or empty raises (fail closed)
-- connector_clients: authenticated can select; authenticated insert/update/delete affect 0 rows or raise
```

- [ ] **Step 4: Run** `pnpm db:test` and confirm the new file fails.
- [ ] **Step 5: Write the migration.** Table + RLS; guard function (`security definer`, fixed `search_path`, reads `current_setting('request.jwt.claims', true)`, `request.method`, `request.path`); anything it cannot parse is refused when a `client_id` is present; register the hook and reload PostgREST config in the migration. Do not alter any existing policy or function.
- [ ] **Step 6: Run** `pnpm exec supabase migration up --local`, then `pnpm db:test` (whole suite) and `pnpm test`. Expected: all pass. Add the paragraph to `docs/ARCHITECTURE.md` §10.

---

### Task 2: Approved apps only

**Files:**
- Create: `src/lib/mcp/clients.ts` (+ test), `scripts/register-connector-client.mjs`
- Modify: `src/lib/mcp/auth.ts` (+ test), `src/app/mcp/route.test.ts`, `supabase/config.toml`, `package.json`, `.env.example`, `scripts/test-mcp.mjs`

**Interfaces:**
- Consumes: `connector_clients` from Task 1; `verifyAccessToken` returning `{ userId, clientId, expiresAt, scopes }` where `clientId` is `"session"` for an ordinary session token.
- Produces: `isAllowedClient(clientId: string, accessToken: string): Promise<boolean>` (queries `connector_clients` with the caller's token; caches a positive answer for 60 s per client id; never caches a negative or an error); npm script `"connector:register": "node --env-file=.env.local scripts/register-connector-client.mjs"`.

- [ ] **Step 1: Failing unit tests.** `clients.test.ts`: listed id → true and second call within 60 s does not query; unlisted → false and is re-queried; query error → false, not cached. `auth.test.ts` / `route.test.ts`: token with an unlisted `client_id` → 401 `invalid_token`; listed → 200; session token with `MCP_ALLOW_SESSION_TOKENS` unset → 401; with `MCP_ALLOW_SESSION_TOKENS=1` → 200.
- [ ] **Step 2: Run** `pnpm test src/lib/mcp src/app/mcp`; confirm failures. **Step 3: Implement.**
- [ ] **Step 4: `register-connector-client.mjs`.** Usage `pnpm connector:register "<name>" [extra redirect address…]`. Reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` from the environment; creates a **public** client (no secret, PKCE) through Supabase's admin OAuth-client API with redirect addresses `https://claude.ai/api/mcp/auth_callback` plus any extras; inserts `(client_id, name)` into `connector_clients`; prints the client id and nothing secret. If a client with that name is already recorded, prints its id and changes nothing. A second mode `--remove <client_id>` deletes the client and its row. Because it writes to whichever project the environment points at, it prints the target host and waits for the operator to type the host back before writing, unless the host is `127.0.0.1`/`localhost`.
- [ ] **Step 5: Config.** In `supabase/config.toml` set `allow_dynamic_registration = false` and `secure_password_change = true`; restart the local stack. `.env.example`: add `MCP_ALLOW_SESSION_TOKENS=` with a comment (local testing only; leave empty in production).
- [ ] **Step 6: Extend `scripts/test-mcp.mjs`.** It now registers its own throwaway client (admin API, local only) with a localhost redirect address, records it in `connector_clients`, and obtains a real OAuth-issued token for user A without a browser: start an authorization request with PKCE, approve it as A with `supabase.auth.oauth.approveAuthorization`, exchange the returned code. New assertion groups: (a) `/mcp` accepts the OAuth token and lists 17 tools; (b) the same token calling the database API directly can `GET` A's wallets, and gets `connector.forbidden` on `POST /rest/v1/transactions`, `POST /rest/v1/rpc/save_transaction` and `POST /rest/v1/rpc/create_wallet`, and no row is written; (c) after the client's row is deleted from `connector_clients`, the still-valid token is refused by the database immediately and by `/mcp` within 60 s; (d) dynamic registration at the local registration endpoint is refused; (e) with the OAuth token, `PUT /auth/v1/user` with a new password — **record the status either way**; the group passes if the password is unchanged, and prints a clearly marked `RESIDUAL` line (not a failure) if it changed. The existing session-token groups run with the app started with `MCP_ALLOW_SESSION_TOKENS=1`; update the header's start command. Everything created is removed in `finally`.
- [ ] **Step 7: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, then start the app against the local stack and run `pnpm test:mcp`. Expected: all groups ok; report the `PUT /auth/v1/user` outcome verbatim.

---

### Task 3: Connected apps in Settings (data and actions)

**Files:**
- Create: `src/features/connect/grants.ts` (+ test)
- Modify: `src/features/connect/actions.ts` (+ test)

**Interfaces:**
- Produces: `type ConnectedApp = { clientId: string; name: string; grantedAt: string | null }`; `getConnectedApps(): Promise<ConnectedApp[] | null>` (null = could not load; names sanitised with the existing `clientName` helper in `src/features/connect/`); Server Action `revokeConnectedApp(clientId: string): Promise<{ ok: true } | { ok: false; error: "invalid" | "failed" }>`; `getConnectorSetup(): Promise<{ url: string; clients: { clientId: string; name: string }[] }>` (address from `mcpUrl`, clients from `connector_clients`).

- [ ] **Step 1: Read the installed types** for `supabase.auth.oauth.listGrants()` and `revokeGrant()` in `node_modules/@supabase/auth-js` and write down the real shapes in the test file's header comment.
- [ ] **Step 2: Failing tests** with the Supabase client mocked: grants mapped to `ConnectedApp` with names sanitised; list error → `null`; no grants → `[]`; `revokeConnectedApp` with a malformed id → `invalid` without calling Supabase; Supabase error → `failed`; success → `ok` and `revalidatePath` called for Settings; signed out → `failed`.
- [ ] **Step 3: Implement. Step 4: Run** `pnpm test src/features/connect`, `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 5: Measure revocation.** Extend `scripts/test-mcp.mjs` with one group: after `revokeGrant`, call `/mcp` and the database API with the access token obtained before revocation. Record whether it is refused at once, or for how long it keeps working (it is a JWT; expect up to its remaining lifetime, at most 3600 s). The group passes either way and prints the measured behaviour; the result goes into `docs/ARCHITECTURE.md` §10 and, if the token outlives revocation, into the Settings copy in Task 4 ("can take up to an hour to take effect").

---

### Task 4: Connected apps in Settings (screen)

**Files:**
- Create: `src/app/[locale]/(app)/settings/connected-apps-section.tsx` (+ test), `docs/mockups/connected-apps.html`, `e2e/connected-apps.spec.ts`
- Modify: `src/app/[locale]/(app)/settings/page.tsx`, `src/app/[locale]/(connect)/connect/page.tsx`, `src/messages/en.json`, `src/messages/ar.json`

**Interfaces:**
- Consumes: `getConnectedApps`, `revokeConnectedApp`, `getConnectorSetup` from Task 3.
- Produces: messages under `settings.connectedApps.*`: `title`, `empty`, `remove`, `removeConfirmTitle`, `removeConfirmBody`, `removed`, `loadFailed`, `howTitle`, `howStep1`, `howStep2`, `howStep3`, `address`, `appId`, `copy`, `copied`, `takesEffect` (only if Task 3 measured a delay); and `connect.removeLater` restored with the copy approved earlier: EN "You can remove its access later in Settings." / AR "يمكنك إزالة وصوله لاحقاً من الإعدادات."

- [ ] **Step 1: Invoke the `impeccable` skill** and follow its setup. Produce a mockup at 390px, EN and AR, of the Settings block in three states: no apps (with the "Connect Claude" help: the connector address and the app id, each with a copy button, and three short steps), one app listed with Remove, and the remove confirmation as a bottom sheet. It sits in Settings near "Sign-in keys" and follows that section's pattern (`passkeys-section.tsx`). **Stop and show the owner; continue only after they approve.**
- [ ] **Step 2: Failing component tests:** empty state shows the help with the address and app id; a listed app shows its name in `<bdi>` and a Remove button ≥ 44px; `null` from `getConnectedApps` shows `loadFailed` and no list; confirming Remove calls `revokeConnectedApp(clientId)` and shows `removed`; a `failed` result shows an error and keeps the row.
- [ ] **Step 3: Build** per the approved mockup: Server Component reads the data; a small client island handles copy, the confirmation sheet (shared responsive Drawer/Dialog) and the action; optimistic removal with no layout jump; skeleton for loading. Restore the `removeLater` line on the consent screen exactly where the mockup `docs/mockups/connect-consent.html` has it.
- [ ] **Step 4: E2E** (demo mode has no backend): on the mobile projects in `en` and `ar`, Settings renders the block's empty/help state with no horizontal overflow and no serious axe violations. Say in the report exactly what demo mode can and cannot show.
- [ ] **Step 5: Live check** on the local stack: connect a throwaway client for a throwaway user (reuse the headless flow from `scripts/test-mcp.mjs`), open Settings, see the app listed, Remove it, confirm it disappears and that a new authorization request shows the consent screen again. Save 390px EN and AR screenshots to `docs/mockups/connected-apps/`.
- [ ] **Step 6: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:e2e e2e/connected-apps.spec.ts e2e/connect.spec.ts e2e/smoke.spec.ts`.

---

### Task 5: Docs and go-live checklist

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§10), `docs/PLAN.md`, `CLAUDE.md` (Commands: `pnpm connector:register`; Connector rules: one line "connected apps are read-only in the database; a new write must be opened in the request guard")

- [ ] **Step 1: Update §10:** the guard and allowlist, approved-apps-only, what Task 2 measured for password change, what Task 3 measured for revocation, the accepted first-opener behaviour.
- [ ] **Step 2: Rewrite the hosted checklist** in order: apply migrations; in the dashboard turn the OAuth server on, set the authorization path to `/oauth/consent`, leave dynamic registration **off**, turn on secure password change, confirm double-confirm email change and Site URL; confirm the pre-request hook is active (one test request from the SQL test's "unknown app" case); run `pnpm connector:register "Claude"` against production and note the app id; deploy with `MCP_ALLOW_SESSION_TOKENS` empty; in Claude add a custom connector with the address and, under advanced settings, the app id; sign in, Allow, ask a read question; then in Settings remove the app and confirm Claude loses access.
- [ ] **Step 3: `docs/PLAN.md`:** tick what Tasks 1 to 4 proved; leave the hosted steps unticked.
- [ ] **Step 4: Final run:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:test`, `pnpm build`, and `pnpm test:mcp` against the local stack. Report each result.
