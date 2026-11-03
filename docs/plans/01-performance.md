# 01 · Speed: taps, actions, navigation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. No commit steps (owner commits).

**Goal:** Bottom-nav taps show the next screen at once, and action buttons (Paid, Got salary, Save) respond in well under a second.

**Owner note:** "Optimise the website as all action buttons are taking while also the bottom navigation, every click is taking while to render."

**Architecture:** Four causes found in the code, fixed in order of payoff:

1. **No `loading.tsx` anywhere under `src/app/[locale]/(app)/`.** Every route is dynamic (auth cookies), so a tab tap waits for the full server render before anything changes on screen, and `<Link>` cannot prefetch a loading state that does not exist.
2. **Every write makes two server round trips.** Each Server Action already calls `revalidatePath("/", "layout")`, which sends the fresh page back with the action response; the client then calls `router.refresh()` and renders everything a second time. 11 call sites (listed in Task 3).
3. **Auth is checked over the network several times per request.** `proxy.ts` → `refreshSession` → `auth.getUser()`, then `getProfile()` → `auth.getUser()` again, and every action's `actionClient()` → `auth.getUser()`. Each is a round trip to Supabase Auth. `auth.getClaims()` verifies the JWT locally when the project uses asymmetric signing keys.
4. **Nothing changes on screen until the server answers** (no optimistic state on Paid / Got salary).

**Tech stack:** Next.js 16 App Router, `@supabase/ssr` 0.12, `@supabase/supabase-js` 2.118 (`getClaims` available), React 19 `useOptimistic`.

## Global constraints

All of [README § Global constraints](README.md#global-constraints-every-plan-every-task). Plus: skeletons, never "Loading…" text; no layout jump when the real content replaces the skeleton (skeleton blocks match the real heights).

## Review focus

- Slow-feeling taps in `pnpm dev` are partly the dev compiler. All timings in this plan are taken on `pnpm build && pnpm start`, or they mean nothing.
- Undo toasts: after removing `router.refresh()`, Undo (which calls `deleteTransaction`) must still update the screen. It does, because `deleteTransaction` revalidates; verify on the live database.
- `getClaims()` falls back to a network call when the project still uses the legacy HS256 secret. Check the hosted project's JWT signing keys first (Task 4 step 1), or the change gains nothing.
- The proxy must still sign out any session whose email is not `OWNER_EMAIL` (until plan 09 removes that rule). Claims carry `email`.
- A skeleton that is shorter than the real screen causes CLS on arrival. Use the real header (`ScreenHeader`) and fixed-height blocks.

---

### Task 1: Measure the baseline

**Files:**
- Create: `src/lib/timing.ts`
- Modify: `src/app/[locale]/(app)/layout.tsx`, `src/app/[locale]/(app)/page.tsx` (wrap queries)

**Interfaces:**
- Produces: `timed<T>(label: string, work: () => Promise<T>): Promise<T>`. Logs `[timing] label 123ms` to the server console only when `process.env.DEBUG_TIMING === "1"`; otherwise just awaits `work`.

- [ ] **Step 1:** Implement `timed` in `src/lib/timing.ts` (`import "server-only"`, `performance.now()`).
- [ ] **Step 2:** Wrap `getProfile`, `getWallets`, `getCategories` in the app layout and the three Home queries with `timed`.
- [ ] **Step 3:** Run `pnpm build`, then `DEBUG_TIMING=1 pnpm start` against the hosted Supabase. In Chrome DevTools (Fast 4G, 4× CPU) record: Home → Activity tap until content; Activity → Home; Paid until toast; Save in Add until sheet closes. Write the four numbers and the `[timing]` lines into the "Baseline" table at the bottom of this file.

### Task 2: Route loading skeletons

**Files:**
- Create: `src/app/[locale]/(app)/loading.tsx`, `src/app/[locale]/(app)/activity/loading.tsx`, `src/app/[locale]/(app)/budgets/loading.tsx`, `src/app/[locale]/(app)/wallets/loading.tsx`, `src/app/[locale]/(app)/settings/loading.tsx`
- Create: `src/components/shell/screen-skeleton.tsx`
- Test: `e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `ScreenSkeleton({ variant }: { variant: "home" | "list" | "form" })`. Header band at the real `ScreenHeader` height, then `Skeleton` blocks: home = 2 cards (salary 152px, fixed 220px) + 5 rows; list = 8 rows of 60px; form = 3 fields of 48px.

The layout (shell, bottom bar) stays mounted, so only the page area shows the skeleton and the tapped tab highlights at once.

- [ ] **Step 1: Write the failing test** in `e2e/smoke.spec.ts`:

```ts
test("tab tap marks the new tab current before the page data arrives", async ({ page }) => {
  await page.goto("/en");
  // Hold the RSC response for Activity so only the loading state can render.
  await page.route("**/en/activity**", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  await page.getByRole("link", { name: "Activity" }).filter({ visible: true }).click();
  await expect(page.getByRole("link", { name: "Activity" }).filter({ visible: true })).toHaveAttribute("aria-current", "page", { timeout: 500 });
  await expect(page.locator("[data-slot=skeleton]").first()).toBeVisible({ timeout: 500 });
});
```

- [ ] **Step 2:** Run `pnpm test:e2e e2e/smoke.spec.ts -g "tab tap"`. Expected: FAIL (no skeleton; `aria-current` waits for the response).
- [ ] **Step 3:** Implement `ScreenSkeleton` and the five `loading.tsx` files (Home uses `home`, Activity and Wallets `list`, Budgets `list`, Settings `form`). Remove the ad-hoc `<Suspense fallback={<div className="h-40 bg-shell" />}>` in `(app)/page.tsx`; `loading.tsx` replaces it.
- [ ] **Step 4:** Re-run the test. Expected: PASS. Run the full e2e suite: all pass.

### Task 3: One round trip per write

**Files (remove `router.refresh()` that follows a Server Action):**
- `src/components/add/transaction-sheet.tsx:139,147`
- `src/components/fixed/fixed-card.tsx:50,56`
- `src/components/fixed/fixed-sheet.tsx:54`
- `src/components/salary/salary-card.tsx:64,70`
- `src/components/salary/salary-sheet.tsx:43`
- `src/components/transactions/detail-sheet.tsx:59,65`
- `src/components/wallets/wallet-sheet.tsx:77`
- `src/app/[locale]/(app)/settings/settings-form.tsx:42` (plan 02 reworks this file; just delete the call here)

- [ ] **Step 1:** Confirm every action these call ends with `revalidatePath("/", "layout")` (`grep -n revalidatePath src/features`). Any that does not gets it added; none may rely on the client refresh.
- [ ] **Step 2:** Delete the `router.refresh()` calls and any `useRouter` import left unused.
- [ ] **Step 3:** `pnpm typecheck && pnpm lint && pnpm test:e2e`. Expected: PASS.
- [ ] **Step 4:** Live check on the production build: Paid, Undo, Got salary, Add + Undo, edit a transaction, archive a wallet. Each updates the screen once. In the Network panel each press shows one POST and no follow-up RSC GET.

### Task 4: Local JWT verification instead of `getUser()`

**Files:**
- Create: `src/lib/supabase/user.ts`
- Modify: `src/lib/supabase/proxy.ts:35`, `src/lib/supabase/action.ts:17`, `src/features/profile/queries.ts:23`, `src/features/profile/actions.ts:17,34`

**Interfaces:**
- Produces: `getUserId = cache(async (): Promise<string | null>)` in `src/lib/supabase/user.ts`, using `(await createClient()).auth.getClaims()` and returning `claims.sub`.
- `refreshSession` keeps its signature `{ email: string | null }`, reading `data.claims.email`.

- [ ] **Step 1:** In the Supabase dashboard → Project Settings → JWT Keys, check the project uses asymmetric signing keys (ES256/RS256). If it shows only the legacy secret, migrate to signing keys (dashboard button; existing sessions stay valid). Note the result here.
- [ ] **Step 2:** Implement `getUserId`. Replace `auth.getUser()` in `actionClient`, `getProfile`, `updateProfile`, `completeOnboarding` with it; replace it in `refreshSession` with `getClaims()` (the proxy needs the session refresh that `getClaims` does through `getSession`).
- [ ] **Step 3:** `pnpm typecheck && pnpm test:e2e`. Expected: PASS (demo mode is unaffected).
- [ ] **Step 4:** Live: sign in, use the app, wait past `jwt_expiry` (1 hour) or delete the access-token cookie, and confirm the proxy refreshes the session without a sign-out. Sign in as a non-owner (if one exists) and confirm the sign-out still happens. Re-run the Task 1 timings.

### Task 5: Instant feedback on Paid and Got salary

**Files:**
- Modify: `src/components/fixed/fixed-card.tsx`, `src/components/salary/salary-card.tsx`
- Test: `e2e/fixed.spec.ts`

**Interfaces:**
- `FixedCard`: `const [optimisticItems, markPaid] = useOptimistic(items, (list, id: string) => list.map((i) => (i.id === id ? { ...i, paidOn: today } : i)))`, with `today` from `todayIn(timezone)` via `useAppData()`.

- [ ] **Step 1: Write the failing test** in `e2e/fixed.spec.ts`: after clicking "Mark Internet as paid", the row shows `Paid` before the action resolves, then (demo mode returns `notConfigured`) the row goes back to the Paid button and the preview error toast shows.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Use `markPaid(item.id)` inside the existing `startTransition` before awaiting `payFixedExpense`. React drops the optimistic state when the transition ends, so a failure reverts by itself. Same pattern in `SalaryCard` for the "received on" line.
- [ ] **Step 4:** Re-run. Expected: PASS. `left to pay` updates with the optimistic list (it is computed from `optimisticItems`).

### Task 6: Region check (no code)

- [ ] Compare the Supabase project region (Dashboard → Settings → General) with where the app is hosted. For a Lebanon-based user the best pair is both in `eu-central-1` (Frankfurt) or the same nearby region. If they differ, write it down here: every query pays the gap twice per request. Moving is the owner's call.

## Baseline (fill in during Task 1, again after Task 4)

| Measurement | Before | After |
| --- | --- | --- |
| Home → Activity tap until content | | |
| Activity → Home | | |
| Paid until toast | | |
| Add → Save until sheet closes | | |

## Decisions made for the owner

- No client-side data cache (SWR, React Query): server rendering stays the single source of truth; the fixes above remove the waits without a second data layer.
- `cacheComponents` stays off (Phase 0 decision); `loading.tsx` gives the instant navigation without it.
