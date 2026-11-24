# MCP Connector, Phase 1 (connect, sign in, read) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude can be connected to the app by URL, each person signs in and approves it, and Claude can read everything that person sees in the app.

**Architecture:** A stateless Streamable HTTP endpoint at `/mcp` (Next.js Route Handler) verifies a Supabase-issued bearer token, then runs tools inside an `AsyncLocalStorage` request context. `createClient()` and `getUserId()` read that context, so existing queries run unchanged under the caller's RLS. Supabase Auth's OAuth 2.1 server issues the tokens; the app adds only a consent screen.

**Tech Stack:** Next.js 16 App Router, `@modelcontextprotocol/server` v2 (official SDK, no `mcp-handler`), `@modelcontextprotocol/client` v2 (dev, for the integration script), `@supabase/supabase-js`, zod v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-mcp-connector-design.md`. Phases 2 and 3 (write tools) get their own plans after this one ships.

## Global Constraints

- **No `git commit`, `git add` or push in any task.** The owner commits manually. A task ends when its tests, `pnpm typecheck` and `pnpm lint` pass.
- The secret key (`SUPABASE_SECRET_KEY`) is never imported under `src/`. Scripts under `scripts/` may use it.
- A connector request never reads or writes cookies. Missing or invalid token means 401, never a cookie fallback.
- Amounts are integer minor units; format only through `src/lib/money.ts`. Never add or compare different currencies; totals are per currency.
- Every user-visible string goes in both `messages/en.json` and `messages/ar.json` in the same change. Tool names and descriptions are English only (read by the model, not shown in the app).
- UI work: invoke the `impeccable` skill first; logical Tailwind utilities only; 390px first; touch targets ≥ 44px; `<bdi>` around names; screenshots at 390px EN and AR before the task is done.
- No host-specific APIs. Pin exact versions of the two `@modelcontextprotocol/*` packages in `package.json` (no `^`).
- SDK names in this plan (`createMcpHandler`, `McpServer`, `registerTool`, `requireBearerAuth`, `oauthMetadataResponse`, `OAuthError`, `ctx.http.authInfo`) come from the v2 docs read on 2026-11-24. If the installed package's type declarations differ, follow the declarations and note the difference in the task report.
- Production is `https://budget.bilalnasr.com` at the root (no base path). Build public addresses as `siteBase(NEXT_PUBLIC_SITE_URL, requestOrigin) + (NEXT_PUBLIC_BASE_PATH ?? "")`.

## Review Focus

1. Garbage, expired or wrong-project token → 401 with a `WWW-Authenticate` header naming the metadata URL; no tool runs. (Task 3)
2. Request with a valid browser session cookie but no bearer token → 401; the cookie is ignored. (Task 3)
3. Two overlapping requests for different people → each sees only its own user id and token. (Task 2)
4. Consent link with a missing, malformed, expired or already-used `authorization_id` → a plain "this link has expired, start again from Claude" state, not an error page. (Task 7)
5. A brand-new account (no wallets, no activity, not onboarded) → every read tool returns an empty or default result, not an error. (Task 8)

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/supabase/request-context.ts` (new) | `AsyncLocalStorage` for one connector request |
| `src/lib/supabase/server.ts`, `user.ts` (modify) | Use the context when present |
| `src/lib/mcp/public-url.ts` (new) | Public addresses of the endpoint and its metadata |
| `src/lib/mcp/auth.ts` (new) | Verify a bearer token with Supabase |
| `src/lib/mcp/tool.ts` (new) | `defineTool`, result helpers, money output helper |
| `src/lib/mcp/registry.ts` (new) | Collects every feature's tools |
| `src/app/mcp/route.ts` (new) | The endpoint |
| `src/app/.well-known/[...path]/route.ts` (new) | Discovery metadata |
| `src/features/<feature>/mcp.ts` (new, per feature) | That feature's tools |
| `src/features/budgets/summary.ts` (new) | Spending summary shared by Home and the tool |
| `src/features/connect/pending-authorization.ts` (new) | Remember a consent request across sign-in |
| `src/app/oauth/consent/route.ts` (new) | Fixed path Supabase redirects to; forwards into the locale |
| `src/app/[locale]/(connect)/connect/` (new) | Consent screen |
| `scripts/test-mcp.mjs` (new) | End-to-end check against the local stack |

---

### Task 1: Go/no-go check and setup

**Files:**
- Modify: `supabase/config.toml` (`[auth.oauth_server]` block, ~line 388), `package.json`, `.env.example`

- [ ] **Step 1: Stop and ask the owner to confirm the hosted project.** In the Supabase dashboard for the production project: Authentication → OAuth Server. Ask them to confirm (a) the feature can be switched on for their plan, (b) "Allow dynamic OAuth apps" is available, (c) whether the page demands asymmetric JWT signing keys and whether those are already on. If (a) or (b) is no, stop the whole plan and report; there is no fallback. Do not change the hosted project yourself.
- [ ] **Step 2: Turn it on locally.** In `supabase/config.toml` set `enabled = true` and `allow_dynamic_registration = true` under `[auth.oauth_server]`; keep `authorization_url_path = "/oauth/consent"`. Run `pnpm db:stop; pnpm db:start`.
- [ ] **Step 3: Verify.** Run `curl http://127.0.0.1:54321/.well-known/oauth-authorization-server/auth/v1`. Expected: JSON containing `authorization_endpoint`, `token_endpoint` and `registration_endpoint`. If the local CLI version lacks the feature, upgrade the `supabase` dev dependency and retry before going on.
- [ ] **Step 4: Install.** `pnpm add --save-exact @modelcontextprotocol/server` and `pnpm add --save-exact -D @modelcontextprotocol/client`. Confirm `pnpm typecheck` still passes.

---

### Task 2: Request context and identity seam

**Files:**
- Create: `src/lib/supabase/request-context.ts`, `src/lib/supabase/request-context.test.ts`
- Modify: `src/lib/supabase/server.ts`, `src/lib/supabase/user.ts`, `src/features/salary/email/summary.ts:34`
- Test: extend `src/lib/supabase/server.test.ts`

**Interfaces:**
- Produces:
  - `type ConnectorContext = { accessToken: string; userId: string }`
  - `runAsConnector<T>(ctx: ConnectorContext, fn: () => Promise<T>): Promise<T>`
  - `connectorContext(): ConnectorContext | undefined`
  - `getUserEmail(): Promise<string | null>` in `user.ts`
  - `createClient()` and `getUserId()` keep their signatures.

- [ ] **Step 1: Write failing tests.**

```ts
// request-context.test.ts
test("no context outside runAsConnector", () => { expect(connectorContext()).toBeUndefined(); });
test("overlapping requests keep their own identity", async () => {
  const seen: string[] = [];
  const job = (id: string, wait: number) => runAsConnector({ accessToken: `t-${id}`, userId: id }, async () => {
    await new Promise((r) => setTimeout(r, wait));
    seen.push(`${id}:${connectorContext()!.userId}:${connectorContext()!.accessToken}`);
  });
  await Promise.all([job("a", 20), job("b", 5)]);
  expect(seen.sort()).toEqual(["a:a:t-a", "b:b:t-b"]);
});
test("getUserId returns the context user and never touches cookies", async () => {
  // mock next/headers so cookies() throws; expect getUserId() inside runAsConnector to resolve "u1"
});
test("getUserId for two users in sequence does not return a cached first user", async () => {
  // runAsConnector(u1) then runAsConnector(u2); expect "u1" then "u2"
});
```

```ts
// server.test.ts additions
test("inside a connector request the client sends the bearer token and cookies() is never called", async () => {
  // mock next/headers cookies to throw; mock @supabase/supabase-js createClient to capture options
  // expect options.global.headers.Authorization === "Bearer tok"
  // expect options.auth to equal { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
test("extra headers (x-budget-units) are kept alongside the bearer token", ...);
test("outside a connector request behaviour is unchanged (existing tests still pass)", ...);
```

- [ ] **Step 2: Run** `pnpm test src/lib/supabase` and confirm the new tests fail.
- [ ] **Step 3: Implement.** In `createClient(headers?)`: when `connectorContext()` is set, return `createClient` from `@supabase/supabase-js` with the publishable key, `global.headers = { ...headers, Authorization: "Bearer <token>" }` and the `auth` options above; do not call `cookies()`. In `getUserId`: check the context **outside** the `cache()` wrapper (export a plain async function that returns the context user id, otherwise calls the cached cookie reader). `getUserEmail()`: with a context, `supabase.auth.getUser(accessToken)`; otherwise `supabase.auth.getUser()`; return `data.user?.email ?? null`. Replace the direct `auth.getUser()` in `salary/email/summary.ts` with `getUserEmail()`, keeping its behaviour when the email is null.
- [ ] **Step 4: Run** `pnpm test src/lib/supabase src/features/salary`, `pnpm typecheck`, `pnpm lint`. Expected: all pass.

---

### Task 3: Endpoint, token check and discovery

**Files:**
- Create: `src/lib/mcp/public-url.ts`, `src/lib/mcp/auth.ts`, `src/lib/mcp/tool.ts`, `src/lib/mcp/registry.ts`, `src/app/mcp/route.ts`, `src/app/.well-known/[...path]/route.ts`, `src/features/profile/mcp.ts`
- Test: `src/lib/mcp/public-url.test.ts`, `src/lib/mcp/auth.test.ts`, `src/lib/mcp/tool.test.ts`, `src/app/mcp/route.test.ts`

**Interfaces:**
- Consumes: `runAsConnector`, `siteBase` from `src/features/auth/redirect.ts`, `getProfile`.
- Produces:
  - `mcpUrl(requestOrigin: string): string` → `<public base>/mcp`; `authServerIssuer(): string` → `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1`; `authServerMetadataUrl(): string` → `${NEXT_PUBLIC_SUPABASE_URL}/.well-known/oauth-authorization-server/auth/v1`
  - `verifyAccessToken(token: string): Promise<{ userId: string; clientId: string; expiresAt: number; scopes: string[] }>`; throws the SDK's invalid-token `OAuthError` on any failure.
  - `type ToolDef = { name: string; title: string; description: string; input?: z.ZodObject; kind: "read" | "write" | "destructive"; run: (args: any) => Promise<unknown> }`
  - `defineTool<S extends z.ZodObject>(def: Omit<ToolDef, "input" | "run"> & { input?: S; run: (args: z.infer<S>) => Promise<unknown> }): ToolDef`
  - `toResult(value: unknown): { content: [{ type: "text"; text: string }]; structuredContent?: Record<string, unknown> }` (text is `JSON.stringify(value)`; arrays are wrapped as `{ items }`)
  - `moneyOut(minor: number, currency: CurrencyDefinition): { minor: number; currency: string; text: string }` (text from `formatAmount`, Latin digits, English)
  - `allTools: ToolDef[]` from `registry.ts`
  - Tool `profile_get` (read, no input) → `getProfile()` result.

- [ ] **Step 1: Write failing tests.**

```ts
// public-url.test.ts
test("uses the configured site, not the request origin", () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://budget.example.com/"); vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  expect(mcpUrl("http://localhost:3000")).toBe("https://budget.example.com/mcp");
});
test("appends the base path", () => { /* BASE_PATH=/budget → https://budget.example.com/budget/mcp */ });
test("falls back to the request origin when unset", () => { /* → http://localhost:3000/mcp */ });

// auth.test.ts (mock @supabase/supabase-js so auth.getClaims is controllable)
test("valid claims map to user id, client id and expiry", ...);          // sub, client_id, exp
test("a session token without client_id is accepted with clientId 'session'", ...);
test.each(["no sub", "role anon", "getClaims error", "exp missing"])("rejects: %s", ...); // throws invalid-token

// tool.test.ts
test("toResult wraps arrays as { items }", ...);
test("registry names are unique, snake_case, and every Phase 1 tool is kind 'read'", ...);

// route.test.ts (call the exported POST with a Request)
test("no Authorization header → 401 with WWW-Authenticate containing resource_metadata=", ...);
test("garbage bearer → 401", ...);
test("valid Supabase session cookie but no bearer → 401", ...);
test("Supabase not configured → 503", ...);
test("valid bearer → tools/list includes profile_get with readOnlyHint true", ...);
```

- [ ] **Step 2: Run** `pnpm test src/lib/mcp src/app/mcp` and confirm failures.
- [ ] **Step 3: Implement `public-url.ts`, `auth.ts`, `tool.ts`, `registry.ts`, `profile/mcp.ts`.** `verifyAccessToken` builds a cookie-less Supabase client and calls `auth.getClaims(token)`; requires `sub`, `role === "authenticated"` and numeric `exp`. Ordinary password-session tokens are accepted on purpose (same person, same RLS); that is what the integration script uses.
- [ ] **Step 4: Implement `src/app/mcp/route.ts`.** `export const dynamic = "force-dynamic"`. Build the SDK handler once with a factory that creates `new McpServer({ name: "budget-tracker", version: <package.json version> })` and registers every `allTools` entry via `registerTool(name, { title, description, inputSchema, annotations }, handler)`; annotations: read → `{ readOnlyHint: true }`, write → `{ readOnlyHint: false, destructiveHint: false }`, destructive → `{ readOnlyHint: false, destructiveHint: true }`. The tool handler reads `ctx.http.authInfo`, then `runAsConnector({ accessToken: authInfo.token, userId }, () => def.run(args))` and returns `toResult(...)`; a thrown error returns `{ isError: true, content: [{ type: "text", text: "Something went wrong. Try again." }] }` without the original message. Gate requests with `requireBearerAuth({ verifier: { verifyAccessToken } })` (no `expectedResource`; see spec §6.2). Export `GET`, `POST`, `DELETE`.
- [ ] **Step 5: Implement the discovery route.** `GET` returns `oauthMetadataResponse(request, { oauthMetadata, resourceServerUrl: mcpUrl(origin) }) ?? 404`, where `oauthMetadata` is fetched from `authServerMetadataUrl()` and held in module memory for one hour. Add `OPTIONS` with permissive CORS for GET. Confirm the 401 from Step 4 names this route's protected-resource URL.
- [ ] **Step 6: Run** `pnpm test src/lib/mcp src/app/mcp`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Expected: all pass; build output lists `/mcp` as a dynamic route.

---

### Task 4: Spending summary shared with Home

**Files:**
- Create: `src/features/budgets/summary.ts`, `src/features/budgets/summary.test.ts`
- Modify: `src/app/[locale]/(app)/page.tsx` (`BudgetData`, lines 20-27)

**Interfaces:**
- Consumes: `getCurrencies`, `getSalaryReceiptDates`, `getMonthBudgets`, `buildCycles`, `pickCycle`, `todayIn`.
- Produces: `getSpendingSummary(timezone: string): Promise<{ calendarMonth: { month: string; budgets: MonthBudgets[] }; salaryCycle: { cycle: SpendCycle; budgets: MonthBudgets[] } | null }>`. One `MonthBudgets` per enabled currency, in `getCurrencies()` order, unfiltered.

- [ ] **Step 1: Write failing tests** with the three queries mocked: no salary receipts → `salaryCycle` is null and `calendarMonth.month` equals `todayIn(tz).slice(0, 7)`; with receipts → `salaryCycle.cycle` equals `pickCycle(buildCycles(dates), null)` and `getMonthBudgets` was called with `(cycle.from.slice(0, 7), code, cycle)`; a disabled currency is skipped.
- [ ] **Step 2: Run** `pnpm test src/features/budgets/summary.test.ts`; confirm failure.
- [ ] **Step 3: Implement,** then change `BudgetData` to call it and render exactly what it rendered before: the salary-cycle budgets when a cycle exists, otherwise the calendar-month budgets, filtered to `totalLimitMinor > 0`, `cycle={salaryCycle !== null}`. Home must not fetch the calendar month when a cycle exists: give `getSpendingSummary` an optional second argument `only?: "active"` that skips the unused half.
- [ ] **Step 4: Run** `pnpm test src/features/budgets`, `pnpm typecheck`, and `pnpm test:e2e e2e/budgets.spec.ts e2e/smoke.spec.ts`. Expected: pass, Home unchanged.

---

### Task 5: Read tools for everyday data

**Files:**
- Create: `src/features/{wallets,categories,currencies,transactions,budgets}/mcp.ts` and a `mcp.test.ts` beside each
- Modify: `src/lib/mcp/registry.ts`

**Interfaces:**
- Consumes: `defineTool`, `moneyOut`, the queries named below.
- Produces these tools (all `kind: "read"`):

| Tool | Input | Calls |
| --- | --- | --- |
| `currencies_list` | none | `getCurrencies()` |
| `wallets_list` | none | `getWallets()` |
| `categories_list` | none | `getCategories()` |
| `transactions_list` | `filters` (the existing `filtersSchema`, optional), `cursor` (existing `cursorSchema`, optional) | `fetchTransactions(filters ?? {}, cursor ?? null)`; returns `{ rows, next }` |
| `summary_get` | none | `getSpendingSummary((await getProfile()).timezone)` |
| `budgets_get` | `month` (`YYYY-MM`, optional, default current month in the profile timezone), `currency` (code) | `getMonthBudgets(month, currency)` |

- [ ] **Step 1: Write failing tests,** queries mocked. For each tool: it calls its query with the mapped arguments and returns the data. Plus: `wallets_list` output has, for every balance, `amount: { minor, currency, text }` built by `moneyOut`; `transactions_list` rows carry `amount` the same way and pass `next` through untouched; `transactions_list` with an invalid filter is rejected by the input schema; `summary_get` output labels the two periods as `calendarMonth.month` and `salaryCycle.cycle.from`/`to` and never contains a cross-currency total.
- [ ] **Step 2: Run** `pnpm test src/features --testNamePattern mcp`; confirm failures.
- [ ] **Step 3: Implement.** Rule for every tool: wherever the query result has a minor-unit amount whose currency is known on the same object, add the `moneyOut` form beside it; do not remove the raw field. Descriptions say what the tool returns and when Claude should use it, in one or two sentences, and name the tool to call next where there is one (for example `transactions_list` mentions passing `next` back as `cursor`). Register all in `registry.ts`.
- [ ] **Step 4: Run** `pnpm test src/features src/lib/mcp`, `pnpm typecheck`, `pnpm lint`.

---

### Task 6: Read tools for the remaining areas

**Files:**
- Create: `src/features/{fixed,installments,salary,loans,pending-payments,items,invoices}/mcp.ts` with `mcp.test.ts` each
- Modify: `src/lib/mcp/registry.ts`

**Interfaces:**
- Produces (all `kind: "read"`; `tz` means `(await getProfile()).timezone`):

| Tool | Input | Calls |
| --- | --- | --- |
| `fixed_expenses_list` | none | `getFixedExpenses(tz)` |
| `installments_list` | none | `getInstallments(tz)` |
| `salary_status_get` | none | `getSalaryStatus(tz)` |
| `loans_list` | none | `getLoans()` |
| `loans_history` | `loanId` (uuid), `before` (int, optional) | `getLoanHistory(loanId, before ?? null)` |
| `pending_payments_list` | none | `getPendingPayments()` |
| `pending_payments_receipts` | `paymentId` (uuid) | `getPendingReceipts(paymentId)` |
| `shopping_items_list` | none | `getShoppingItems()` |
| `invoices_folders_list` | none | `getInvoiceFolders()` |
| `invoices_folder_get` | `folderId` (uuid) | `getInvoiceFolder(folderId)`; null → tool error "Folder not found." |

- [ ] **Step 1: Write failing tests** in the same style as Task 5, including: non-uuid ids rejected by the input schema; `invoices_folder_get` on null returns `isError`; the registry test from Task 3 now expects exactly 17 tools.
- [ ] **Step 2: Run and confirm failures.**
- [ ] **Step 3: Implement** with the Task 5 rules.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`.

---

### Task 7: Sign-in and consent

**Files:**
- Create: `src/features/connect/pending-authorization.ts` (+ test), `src/features/connect/actions.ts` (+ test), `src/app/oauth/consent/route.ts` (+ test), `src/app/[locale]/(connect)/connect/page.tsx`, `src/app/[locale]/(connect)/connect/consent-form.tsx`, `e2e/connect.spec.ts`
- Modify: `src/proxy.ts`, `src/features/auth/actions.ts` (`signIn` ~line 82, `afterSignInPath`, `updatePassword` ~line 209, `signOut`), `src/app/auth/confirm/route.ts` (~line 36), `messages/en.json`, `messages/ar.json`

**Interfaces:**
- Produces:
  - `AUTHORIZATION_COOKIE = "connect_authorization"`; `authorizationIdSchema` = string matching `/^[A-Za-z0-9_-]{8,128}$/`
  - `connectPathFor(value: unknown): string | null` → `/connect?authorization_id=<id>` or null
  - `rememberAuthorization(id: string, opts?: { secure?: boolean })` → cookie object or null (same shape as `rememberJoin`, 1 hour max age)
  - `takePendingAuthorization(): Promise<string | null>`, `forgetPendingAuthorization(): Promise<void>`, `hasPendingAuthorization(): Promise<boolean>`
  - Server Action `decideAuthorization(authorizationId: string, decision: "approve" | "deny"): Promise<{ ok: true; redirectUrl: string } | { ok: false; error: "invalid" | "expired" | "failed" }>`
  - Messages namespace `connect`: `title`, `intro`, `appName`, `sendsTo`, `canRead`, `canChange`, `allow`, `deny`, `expiredTitle`, `expiredBody`, `signedInAs`.

- [ ] **Step 1: Invoke the `impeccable` skill** and follow its setup. Produce a mockup of the consent screen at 390px in EN and AR (app name as claimed by the client, the address approval is sent to, what approving allows, who is signed in, Allow and Deny) and of the expired state. **Stop and show the owner; continue only after they approve the mockup.**
- [ ] **Step 2: Write failing unit tests.**
  - `pending-authorization.test.ts`: mirror `src/features/invoices/pending-join.test.ts` (valid id remembered; invalid id yields null and is never turned into a path; take clears the cookie).
  - `oauth/consent/route.test.ts`: `?authorization_id=abc12345` → 307 to `/<locale>/connect?authorization_id=abc12345` (locale from the profile cookie/`Accept-Language` the way next-intl resolves it; default `en`); missing or malformed id → redirect to `/<locale>/connect` with no query.
  - `connect/actions.test.ts`: approve returns Supabase's `redirect_url`; deny likewise; malformed id → `invalid` without calling Supabase; Supabase error → `expired`; signed out → `failed`.
  - `features/auth/actions.test.ts` additions: after `signIn`, a pending share link still wins; with none, a pending authorization redirects to its connect path; with neither, `/`. Same order for `afterSignInPath`, `updatePassword` and `/auth/confirm`. `signOut` forgets the authorization cookie.
- [ ] **Step 3: Run and confirm failures.**
- [ ] **Step 4: Implement the plumbing.** In `proxy.ts`: when a signed-out visitor requests `/(en|ar)/connect` with a valid `authorization_id`, set the remembered cookie on the sign-in redirect (same place `rememberJoin` is applied). The connect path is not added to `PUBLIC`. After sign-in the order is: share link, then authorization, then home. A not-yet-onboarded account follows the existing join rule (cookie kept until onboarding ends).
- [ ] **Step 5: Build the screen** per the approved mockup. Server Component page calls `supabase.auth.oauth.getAuthorizationDetails(id)`; if the result carries a redirect URL with no `authorization_id` (already consented), redirect there; on error render the expired state. `consent-form.tsx` (client) calls `decideAuthorization` and then `window.location.assign(redirectUrl)`. Client name and redirect host are wrapped in `<bdi>`. Route group `(connect)` has no app shell; reuse the `(auth)` layout's framing.
- [ ] **Step 6: E2E.** `e2e/connect.spec.ts` on the mobile projects in `en` and `ar`: a signed-in visitor opening `/connect?authorization_id=notreal123` sees the expired state, no horizontal overflow, visible `h1`, axe has no serious violations. A signed-out visitor opening the same address lands on sign-in and, after signing in, back on the connect screen.
- [ ] **Step 7: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm test:e2e e2e/connect.spec.ts e2e/auth.spec.ts`. Save 390px EN and AR screenshots of both states.

---

### Task 8: End-to-end check and docs

**Files:**
- Create: `scripts/test-mcp.mjs`
- Modify: `package.json` (script `test:mcp`), `CLAUDE.md` (commands list), `docs/ARCHITECTURE.md` (new "Claude connector" section + hosted setup checklist from spec §6.7), `docs/PLAN.md`, `.env.example` (comment that `NEXT_PUBLIC_SITE_URL` must be the public HTTPS address for the connector)

**Interfaces:**
- Consumes: the running app (`pnpm build && pnpm start`, or `pnpm dev`) and local Supabase; `SUPABASE_SECRET_KEY` from `.env.local` (script only).

- [ ] **Step 1: Write `scripts/test-mcp.mjs`** (`"test:mcp": "node --env-file=.env.local scripts/test-mcp.mjs"`). It:
  1. Creates two confirmed users with the admin API (random emails at `example.test`), signs each in with password to get an access token, and deletes both in a `finally`.
  2. Asserts `POST /mcp` with no token is 401 and its `WWW-Authenticate` URL returns JSON whose `authorization_servers` contains the local `…/auth/v1`.
  3. Connects as user A with `Client` + `StreamableHTTPClientTransport` from `@modelcontextprotocol/client`, sending the bearer token through the transport's request-header option (confirm the option name in the installed types).
  4. Asserts `listTools()` returns exactly the 17 names from Tasks 3, 5 and 6, each with `readOnlyHint: true`.
  5. Calls every no-input tool as user A (a fresh account) and asserts none returns `isError` (Review Focus 5).
  6. Inserts one wallet and one expense for user A directly through supabase-js with A's token, then asserts `transactions_list` as A returns that expense with `amount.text` set, and as user B returns zero rows; `invoices_folder_get` as B with a folder id A created returns `isError`.
- [ ] **Step 2: Run** `pnpm db:reset`, start the app, `pnpm test:mcp`. Expected: exits 0 and prints one `ok` line per assertion group.
- [ ] **Step 3: Try the real sign-in locally.** Run `npx @modelcontextprotocol/inspector` against `http://localhost:3000/mcp`, complete registration → sign-in → consent → token in the browser, and call `profile_get`. Record the result in the task report. If the inspector cannot finish the flow, report exactly where it stopped; do not mark the task done.
- [ ] **Step 4: Update the docs** listed above. In `docs/PLAN.md` add the connector phases with Phase 1's boxes ticked only for what Steps 2 and 3 proved.
- [ ] **Step 5: Final run** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Then hand the owner the hosted checklist: turn on the OAuth server and dynamic registration, set the authorization path to `/oauth/consent`, confirm Site URL, deploy, add `https://budget.bilalnasr.com/mcp` in Claude as a custom connector, and ask "what did I spend this month?".
