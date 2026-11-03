# 08 · Budgets section

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. No commit steps (owner commits).

**Goal:** The Budgets tab shows, for the chosen month and currency, each category's monthly limit, what was spent and what is left, with over-budget clearly marked; limits are edited in one sheet and carry into the next months automatically.

**Owner note:** "Implement the budget section." (Replaces the "Soon" placeholder in `src/app/[locale]/(app)/budgets/page.tsx`; this is Phase 4 in `docs/PLAN.md` minus the categories manager.)

**Architecture:**
- **Table `budgets`**: one row per (category, currency, starting month). The limit for month M is the newest row with `starts_month <= M`. Editing in month M writes rows with `starts_month = M`, so past months keep their old limits and future months inherit the new one. Removing a budget writes a row with `limit_minor = null` ("no budget from this month on").
- **Spending** comes from `transactions` (kind `expense`, not deleted, date inside the month), per category and currency. Subcategory spending rolls up into its parent. Fixed-expense and installment payments are expense transactions, so they count automatically.
- Two SQL functions (`security invoker`, so RLS applies): `month_budgets(month date)` and `month_category_spend(month date)`. A single Server Component query calls both; the page computes rows with one pure function.
- **Edit sheet** shows a running total of all limits next to plan 05's "Salary after fixed" in the same currency, so the owner sees what is unbudgeted.
- **Home v2** gets a "Left to spend this month" line per currency (Phase 4 item), from the same data.

**Tech stack:** Postgres functions + RLS, pgTAP (set up in plan 07; if 08 runs first, do that setup here), `TileBar`, `MonthSwitcher` (`?month=YYYY-MM`), `CategorySelect` not needed (rows are per category).

## Global constraints

All of [README § Global constraints](README.md#global-constraints-every-plan-every-task). Plus the CLAUDE.md rule: **a new screen gets a mockup for the owner before the full build** (Task 1). Over-budget is shown with an icon **and** text, never colour alone.

## Review focus

- A month with no budgets at all: an empty state with "Set budgets" (not a list of zero bars).
- Spending in a category that has no budget: listed under "Not budgeted" with the amount, so totals are honest.
- Month boundaries use the profile timezone (`Asia/Beirut` default), same as `todayIn`; a transaction dated the 1st must land in that month.
- Going back to a month before any budget existed: shows "No budgets this month", not the current ones.
- Only USD wallets (or only LBP): hide the currency switch and use the one currency.
- Archived category with a budget: still shown for months where it had spending or a limit, marked archived; not offered in the edit sheet.

---

### Task 1: Mockup for the owner

- [ ] **Step 1:** Run `/impeccable` (shape) against `.impeccable/surfaces/src-app-locale.md` and `DESIGN.md`. Produce 390px mockups in EN and AR: Budgets list (summary band + rows with TileBar, one over budget, "Not budgeted" group), the edit sheet with running total, and the empty state. Add them to `docs/mockups/` as `budgets.html`.
- [ ] **Step 2:** Show the owner. **Stop here until approved.** Record the decision in this file.

### Task 2: Migration and SQL tests

**Files:**
- Create: `supabase/migrations/20261110000200_budgets.sql`, `supabase/tests/budgets.test.sql`
- Regenerate: `src/lib/supabase/database.types.ts`

**Schema:**

```sql
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  currency public.currency not null,
  starts_month date not null check (extract(day from starts_month) = 1),
  limit_minor bigint check (limit_minor is null or limit_minor between 1 and 1000000000000000),
  created_at timestamptz not null default now(),
  unique (user_id, category_id, currency, starts_month)
);
```

Integrity trigger: category is the caller's, top-level (`parent_id is null`) and `kind = 'expense'`. RLS as in the other tables.

```sql
-- Limit in force for each (category, currency) in the given month. Rows whose newest limit is null are omitted.
create function public.month_budgets(p_month date)
returns table (category_id uuid, currency public.currency, limit_minor bigint, starts_month date)
language sql stable security invoker set search_path = '' as $$ … distinct on (category_id, currency) … order by starts_month desc $$;

-- Expense totals per top-level category and currency for the month [p_month, p_month + 1 month).
create function public.month_category_spend(p_month date)
returns table (category_id uuid, currency public.currency, spent_minor bigint)
language sql stable security invoker set search_path = '' as $$ … coalesce(c.parent_id, c.id) … $$;
```

- [ ] **Step 1: Write the failing pgTAP tests:** a limit set in 2026-10 applies to 2026-11 and 2026-12; a new limit in 2026-12 leaves 2026-11 unchanged; a null row in 2027-01 removes it from 2027-01 on; subcategory spending counts under its parent; transfers, income and soft-deleted rows are excluded; a budget on an income category or a subcategory is refused; user B sees none of user A's budgets or spending.
- [ ] **Step 2:** `pnpm db:test`. Expected: FAIL.
- [ ] **Step 3:** Write the migration; `pnpm db:reset && pnpm db:test`. Expected: PASS. `pnpm db:types`. Apply to the hosted project.

### Task 3: Feature module

**Files:**
- Create: `src/features/budgets/schema.ts`, `src/features/budgets/rows.ts`, `src/features/budgets/rows.test.ts`, `src/features/budgets/queries.ts`, `src/features/budgets/actions.ts`
- Modify: `src/lib/demo-data.ts` (`demoBudgets(month)`, `demoSpend(month)` derived from the demo transactions)

**Interfaces:**

```ts
// schema.ts
export type BudgetRow = {
  categoryId: string;
  limitMinor: number | null;   // null = not budgeted
  spentMinor: number;
  leftMinor: number | null;    // limit − spent, negative when over
  progress: number;            // spent / limit, 0 when no limit
};
export type MonthBudgets = {
  month: string;               // YYYY-MM
  currency: Currency;
  rows: BudgetRow[];           // budgeted first (category position), then not budgeted with spending
  totalLimitMinor: number;
  totalSpentMinor: number;     // all spending in the currency, budgeted or not
};
export const budgetEditSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  currency: z.enum(["USD", "LBP"]),
  limits: z.array(z.object({ categoryId: z.uuid(), limitMinor: z.number().int().min(1).max(MAX_MINOR).nullable() })).max(200),
});

// rows.ts (pure, used by live and demo)
export function buildMonthBudgets(month: string, currency: Currency, categories: Category[],
  budgets: { categoryId: string; currency: Currency; limitMinor: number }[],
  spend: { categoryId: string; currency: Currency; spentMinor: number }[]): MonthBudgets;

// queries.ts
export async function getMonthBudgets(month: string, currency: Currency): Promise<MonthBudgets>;

// actions.ts
/** Upserts one row per changed category with starts_month = first of `month`. Unchanged categories are not written. */
export async function saveBudgets(input: BudgetEdit): Promise<ActionResult>;
```

- [ ] **Step 1: Write the failing tests** `rows.test.ts`: Groceries limit $300, spent $340 → `leftMinor = -4000`, `progress ≈ 1.133`; Transport limit $50, spent $0 → `progress = 0`; Fun no limit, spent $15 → in the not-budgeted tail with `limitMinor = null`; LBP spending never appears in the USD result; `totalSpentMinor` includes not-budgeted spending.
- [ ] **Step 2:** `pnpm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `rows.ts`, then queries (two `rpc` calls in `Promise.all`) and actions (`upsert` on the unique key, then `revalidatePath("/", "layout")`).
- [ ] **Step 4:** `pnpm test && pnpm typecheck`. Expected: PASS.

### Task 4: Budgets screen

**Files:**
- Modify: `src/app/[locale]/(app)/budgets/page.tsx` (reads `?month` and `?currency`)
- Create: `src/components/budget/budgets-view.tsx`, `src/components/budget/budget-row.tsx`
- Modify: messages (`Budgets` namespace; delete `Soon.budgetsBody`)
- Test: `e2e/budgets.spec.ts`

Layout (follow the approved mockup): `ScreenHeader` with title and month switcher; summary band "Spent {spent} of {limit} · {left} left" (or "Over by {amount}"); currency `Segmented` (only if both currencies have wallets); rows: glyph, name, `TileBar`, "{left} left" or icon + "Over by {amount}" in the over tone, "of {limit}" muted. Tapping a row opens Activity filtered to that category and month (`/activity?categoryId=…&from=YYYY-MM-01&to=YYYY-MM-last`); a small "+" on the row opens Add with that category pre-selected (`openAdd({ kind: "expense", categoryId })`, extend `ComposerPreset`). "Edit budgets" button in the header.

- [ ] **Step 1: Write the failing tests** with the demo data: rows render with their amounts; an over-budget row has the text "Over by"; tapping a row navigates to `/en/activity?categoryId=…`; the month switcher changes `?month` and the rows; Arabic at 320/390 with no overflow and LTR amounts; empty state for a month before any demo budget.
- [ ] **Step 2:** `pnpm test:e2e e2e/budgets.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add `budgets` to `ScreenSkeleton` (plan 01) if the row height differs.
- [ ] **Step 4:** Re-run the suite. Expected: PASS.

### Task 5: Edit budgets sheet

**Files:**
- Create: `src/components/budget/budgets-sheet.tsx`
- Modify: `src/components/shell/composer.tsx` (`openBudgets({ month, currency })`), messages
- Test: `e2e/budgets.spec.ts`

Sheet: one row per active top-level expense category: glyph, name, amount input (`inputMode` decimal for USD, numeric for LBP, empty = no budget). Sticky footer: "Total {sum}" and, when a salary in this currency exists, "Salary after fixed {amount} · Unbudgeted {salaryAfter − sum}" (from plan 05's `summarizeFixed`; hidden if 05 has not landed). Save writes only the changed rows. Copy under the title: "Applies to {month} and the months after."

- [ ] **Step 1: Write the failing tests:** the running total updates as limits are typed; clearing a field marks that category "No budget"; Save in demo mode shows the preview message.
- [ ] **Step 2:** Run; expected FAIL. Implement; re-run; expected PASS.

### Task 6: Home "Left to spend this month"

**Files:**
- Modify: `src/app/[locale]/(app)/page.tsx` (load `getMonthBudgets(currentMonth, c)` for each currency the owner has wallets in), `src/components/home/home-view.tsx`
- Test: `e2e/smoke.spec.ts`

Under the balance in the shell header: "Left to spend this month: {left}" per currency with budgets, and an over-budget callout ("2 categories over budget", linking to Budgets) when any row is over. Hidden when no budgets exist.

- [ ] **Step 1:** Failing e2e test for the line and the callout with demo data. Run; FAIL.
- [ ] **Step 2:** Implement; re-run; PASS. Check at 390 × 844 that the answer to "how am I doing" is above the fold (Phase 4 acceptance).
- [ ] **Step 3:** Tick the Phase 4 budget items in `docs/PLAN.md`; the categories manager stays open there.

## Decisions made for the owner

- Budgets are per category **per currency**: a USD limit and an LBP limit for Groceries are separate, because the two are never added.
- Limits are set on top-level categories only; subcategory spending counts under its parent.
- No rollover of unspent money into the next month (simpler; every month starts from its limit).
