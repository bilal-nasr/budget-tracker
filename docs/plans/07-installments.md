# 07 · Installments

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. No commit steps (owner commits).

**Goal:** Fixed expenses can be an **installment**: a total to pay off over time, with what is left after each payment, its own payment history (amount, date, wallet), a default wallet, and the option to pay any single payment from another wallet.

**Owner note:** "Add installment to fixed expenses where I can add the total and you can track what is left after each payment and it will have its own payment history with amount, date, and what wallet paid from. There is a default wallet for installment and for a certain payment it can be recorded with another wallet."

**Architecture:**
- New table `installments`. Each payment is an ordinary **expense transaction** linked by `transactions.installment_id` and tagged `source = 'installment'`, exactly like fixed-expense payments (`fixed_expense_id`, `source = 'fixed'`). So payments deduct from their wallet, show in Activity, count toward category spending and budgets, and can be edited or deleted with the existing detail sheet. History is a query, not a second ledger.
- An installment has one currency, copied from its default wallet when created and never changed. A payment's wallet must have that currency (any active wallet, not only the default), so "paid" and "left" are always in one currency.
- `paid_before_minor` records what was already paid before the app existed (an installment started months ago), without fake transactions.
- What is left = `total − paid_before − sum(live payments)`. The database refuses a payment that would go below zero.
- Installments with a monthly amount join plan 05's totals: they count in "Total fixed", "Per wallet" (on the default wallet) and "Salary after fixed".
- UI lives in the Fixed expenses card: an **Installments** group under the monthly items. The Add button's sheet gets a `Monthly | Installment` switch.

**Tech stack:** Postgres (triggers, `security_invoker` view, RLS), pgTAP via `supabase test db`, Server Actions, existing sheets.

## Global constraints

All of [README § Global constraints](README.md#global-constraints-every-plan-every-task).

## Review focus

- Editing a payment in Activity to a larger amount, or "restoring" a deleted payment, must also respect the remaining amount (the trigger runs on update, not only insert).
- Lowering an installment's total below what is already paid is refused with a clear message.
- Deleting an installment keeps its payments in Activity (link becomes null), like fixed expenses. The confirm sheet says so.
- Paying the last part: amount pre-fills with exactly what is left; after saving, the row shows "Paid off" and drops into the collapsed "Paid off" group.
- The default wallet gets archived: the installment still shows; Pay pre-selects no wallet and asks for one; same-currency wallets stay offered.

---

### Task 1: Migration and SQL tests

**Files:**
- Create: `supabase/migrations/20261110000100_installments.sql`
- Create: `supabase/tests/installments.test.sql` (first pgTAP file in the repo)
- Modify: `package.json` (script `"db:test": "supabase test db"`), `CLAUDE.md` command list
- Regenerate: `src/lib/supabase/database.types.ts`

**Schema:**

```sql
create table public.installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  total_minor bigint not null check (total_minor between 1 and 1000000000000000),
  paid_before_minor bigint not null default 0 check (paid_before_minor >= 0),
  currency public.currency not null,          -- set from the default wallet by the trigger
  wallet_id uuid not null references public.wallets (id),     -- default wallet
  category_id uuid not null references public.categories (id),
  monthly_minor bigint check (monthly_minor is null or monthly_minor between 1 and 1000000000000000),
  due_day smallint check (due_day is null or due_day between 1 and 31),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  check (paid_before_minor <= total_minor)
);
alter table public.transactions
  add column installment_id uuid references public.installments (id) on delete set null;
-- source check gains 'installment'
```

**Triggers (both `security invoker`, `set search_path = ''`, execute revoked from public/anon/authenticated):**
- `installments_integrity` (before insert/update): `user_id` immutable; wallet is the caller's and not archived on insert or wallet change; on insert `new.currency := wallet.currency`; on update `currency` immutable and the new wallet's currency must equal it; category is an expense category; `total_minor >= paid_before_minor + sum(live payments)`, else `raise exception 'total below paid'`.
- `transactions_installment_check` (before insert/update on `transactions`, when `new.installment_id is not null`): kind must be `expense`; the wallet's currency (look it up from `wallets`; this trigger fires **before** `transactions_integrity` alphabetically, so `new.currency` is not set yet) must equal the installment's; when `new.deleted_at is null`, `paid_before + sum(other live payments) + new.amount_minor <= total`, else `raise exception 'exceeds remaining'`.

**View:** `installment_progress (security_invoker = true)`: `installment_id, paid_minor (paid_before + live payments), remaining_minor, payment_count, last_paid_on`.

**RLS:** select/insert/update/delete policies `user_id = (select auth.uid())`, as in `20261108000000_fixed_expenses.sql`. Index `transactions_installment_idx on transactions (installment_id, occurred_on desc) where installment_id is not null and deleted_at is null`.

- [ ] **Step 1: Write the failing pgTAP tests** `supabase/tests/installments.test.sql` (as two users set via `set local role authenticated; set local request.jwt.claims = '{"sub": "<uuid>"}'`):
  1. create installment total 1000.00 on a USD wallet → `currency = 'USD'`;
  2. payment of 400.00 then 600.00 succeed; a further 0.01 → `throws_ok(..., 'exceeds remaining')`;
  3. updating a payment from 400.00 to 400.01 → throws; soft-deleting it then paying 400.00 again succeeds;
  4. payment from an LBP wallet → throws; from a second USD wallet → succeeds;
  5. `update installments set total_minor = 50000` (below paid) → throws `'total below paid'`;
  6. user B cannot select user A's installment or progress row;
  7. deleting the installment leaves the payments with `installment_id is null`.
- [ ] **Step 2:** `pnpm db:start && pnpm db:test`. Expected: FAIL (table missing).
- [ ] **Step 3:** Write the migration. `pnpm db:reset && pnpm db:test`. Expected: PASS. Then `pnpm db:types`.
- [ ] **Step 4:** Apply to the hosted project (dashboard SQL editor, as before) and tick it in `docs/PLAN.md`.

### Task 2: Feature module (schema, queries, actions, demo data)

**Files:**
- Create: `src/features/installments/schema.ts`, `src/features/installments/queries.ts`, `src/features/installments/actions.ts`
- Modify: `src/lib/supabase/action.ts` (`ActionError` gains `"exceedsRemaining"` and `"totalBelowPaid"`), `src/lib/demo-data.ts`, `src/app/[locale]/(app)/page.tsx` (load installments for Home)

**Interfaces:**

```ts
// schema.ts
export const installmentInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  totalMinor: z.number().int().min(1).max(MAX_MINOR),
  paidBeforeMinor: z.number().int().min(0).max(MAX_MINOR),
  walletId: z.uuid(),
  categoryId: z.uuid(),
  monthlyMinor: z.number().int().min(1).max(MAX_MINOR).nullable(),
  dueDay: z.number().int().min(1).max(31).nullable(),
}).refine((v) => v.paidBeforeMinor <= v.totalMinor);
export const installmentPaymentSchema = z.object({
  installmentId: z.uuid(), walletId: z.uuid(),
  amountMinor: z.number().int().min(1).max(MAX_MINOR),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type InstallmentPayment = { transactionId: string; amountMinor: number; occurredOn: string; walletId: string };
export type Installment = {
  id: string; name: string; currency: Currency; walletId: string; categoryId: string;
  totalMinor: number; paidBeforeMinor: number; monthlyMinor: number | null; dueDay: number | null;
  paidMinor: number; remainingMinor: number; paidThisMonthMinor: number;
  payments: InstallmentPayment[];   // newest first
};
/** min(monthly, remaining + paidThisMonth); 0 when there is no monthly amount. */
export function dueThisMonth(i: Installment): number;

// queries.ts
export async function getInstallments(timezone: string): Promise<Installment[]>;

// actions.ts (all revalidatePath("/", "layout"))
export async function createInstallment(input: InstallmentInput): Promise<ActionResult>;
export async function updateInstallment(id: string, input: InstallmentInput): Promise<ActionResult>;
export async function deleteInstallment(id: string): Promise<ActionResult>;
/** Name and category come from the saved installment; amount, wallet and date from the input. */
export async function payInstallment(input: InstallmentPaymentInput): Promise<ActionResult<{ id: string }>>;
```

Database errors map to codes by message: `'exceeds remaining'` → `exceedsRemaining`, `'total below paid'` → `totalBelowPaid`, anything else → `failed`.

**Demo data** (`demoInstallments()`): "Laptop", total $1,200.00, monthly $100.00, Bank, three $100.00 payments (this month, last month, two months ago) → left $900.00; "Fridge", total $600.00, monthly $150.00, Bank, paid off.

- [ ] **Step 1: Write the failing unit test** `src/features/installments/schema.test.ts` for `dueThisMonth`: Laptop → 10000; Fridge → 0; monthly null → 0; remaining 5000 with monthly 10000 and nothing paid this month → 5000.
- [ ] **Step 2:** `pnpm test`. Expected: FAIL.
- [ ] **Step 3:** Implement schema, queries (one select of installments + one select of linked transactions; compute progress in TS so demo and live share the code), actions, demo data.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`. Expected: PASS.

### Task 3: Installments in the fixed totals

**Files:**
- Modify: `src/features/fixed/summary.ts`, `src/features/fixed/summary.test.ts`, `e2e/fixed.spec.ts`

**Interfaces:**
- `summarizeFixed(items, walletById, salary, installments: Installment[] = [])`: each installment adds `dueThisMonth(i)` to `total[i.currency]` and to its default wallet's `totalMinor`, and `max(0, dueThisMonth(i) − i.paidThisMonthMinor)` to `left` and `unpaidMinor`.

- [ ] **Step 1:** Add tests: with the demo Laptop, `total.USD = 57500`, Bank `totalMinor = 53000`, `left.USD` stays `7500`, `salaryAfter.minor = 122500`. Update plan 05's e2e expectations to **$575.00**, Bank **$530.00**, salary after **$1,225.00**.
- [ ] **Step 2:** Run; expected FAIL. Implement; re-run; expected PASS.

### Task 4: Installment rows and the Pay sheet

**Files:**
- Create: `src/components/installments/installment-row.tsx`, `src/components/installments/installment-pay-sheet.tsx`
- Modify: `src/components/fixed/fixed-card.tsx`, `src/components/shell/composer.tsx` (`openInstallment(item | null)`, `openInstallmentPay(item)`), `src/components/home/home-view.tsx`, messages
- Test: `e2e/installments.spec.ts`

**Row:** name (`<bdi>`), "{left} left of {total}", `TileBar value={paidMinor / totalMinor}` (label "Laptop: $300.00 of $1,200.00 paid"), and a **Pay** button, or "Paid off ✓" when `remainingMinor === 0`. Paid-off rows sit in a collapsed "Paid off ({count})" disclosure.

**Pay sheet** (`SheetShell`, title "Pay {name}"): amount field pre-filled with `min(dueThisMonth || remaining, remaining)`; wallet chips limited to active wallets of `currency`, default wallet pre-selected; collapsed date row (today); live line "Left after this payment: {amount}"; Save "Record payment" disabled when amount > remaining (inline error "That is more than what is left ({amount})"). Success → toast with Undo (`deleteTransaction`).

**Strings (`Installments` namespace):** `title` Installments / الأقساط; `leftOf` {left} left of {total} / المتبقي {left} من {total}; `pay` Pay / ادفع; `payTitle` Pay {name} / دفع {name}; `paidOff` Paid off / مسدّد; `paidOffGroup` Paid off ({count}) / المسدّدة ({count}); `leftAfter` Left after this payment: {amount} / المتبقي بعد هذه الدفعة: {amount}; `tooMuch` That is more than what is left ({amount}). / هذا أكثر من المتبقي ({amount}).; `record` Record payment / سجّل الدفعة; `recorded` Payment recorded / تم تسجيل الدفعة; `undo` Undo / تراجع.

- [ ] **Step 1: Write the failing tests** `e2e/installments.spec.ts`:

```ts
test("installment row shows what is left and a Pay button", async ({ page }) => {
  await page.goto("/en");
  const card = page.getByRole("region", { name: "Fixed expenses" });
  const row = card.getByRole("listitem").filter({ hasText: "Laptop" });
  await expect(row).toContainText("$900.00 left of $1,200.00");
  await expect(row.getByRole("button", { name: "Pay Laptop" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Paid off (1)" })).toBeVisible();
});

test("Pay sheet pre-fills the monthly amount, offers only same-currency wallets, blocks overpaying", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: "Pay Laptop" }).click();
  const dialog = page.getByRole("dialog", { name: "Pay Laptop" });
  await expect(dialog.getByLabel("Amount")).toHaveValue("100");
  await expect(dialog.getByRole("radio", { name: /Bank · USD/ })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: /LBP/ })).toHaveCount(0);
  await expect(dialog.getByText("Left after this payment: $800.00")).toBeVisible();
  await dialog.getByLabel("Amount").fill("901");
  await expect(dialog.getByRole("button", { name: "Record payment" })).toBeDisabled();
});
```

Arabic variant with no overflow at 320px and the sheet open.

- [ ] **Step 2:** `pnpm test:e2e e2e/installments.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement row, sheet, composer wiring.
- [ ] **Step 4:** Re-run the whole suite. Expected: PASS.

### Task 5: Create, edit, history, delete

**Files:**
- Create: `src/components/installments/installment-sheet.tsx`
- Modify: `src/components/fixed/fixed-sheet.tsx` (a `Segmented` "Monthly | Installment" at the top when creating; Installment renders `InstallmentForm`), messages
- Test: `e2e/installments.spec.ts`

**Installment sheet** (create and edit): Name, Total, Already paid before (optional, collapsed under "Started before using the app?"), Default wallet (chips; on edit only same-currency wallets), Category (`CategorySelect` from plan 04), Monthly payment (optional, "Used for your monthly totals"), Due day (optional). On edit, below the form: **Payment history** list, newest first, each row date · wallet (`<bdi>`) · amount; tapping a row opens the existing `DetailSheet` for that transaction (edit/delete there). "Paid before the app" appears as the last history line when `paidBeforeMinor > 0`. Delete button at the bottom → `ConfirmSheet` (plan 03) with `tone="danger"`: "Delete {name}? Its payments stay in Activity."

- [ ] **Step 1: Write the failing tests:** opening Laptop shows three history rows with `$100.00` and wallet `Bank`; switching the Add sheet to Installment shows Total and Monthly payment fields and Save stays disabled until Name, Total, wallet and category are set; Delete opens the confirm sheet with the "payments stay" line.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run the suite; `pnpm test` (message parity). Screenshots at 390px EN/AR: card with installments, Pay sheet, edit sheet with history.
- [ ] **Step 5:** Live: create an installment with "already paid", pay from the default wallet, pay once from another USD wallet, edit a payment in Activity to more than what is left (refused), delete a payment (left goes back up), delete the installment (payments stay).

## Decisions made for the owner

- Payments from a different-currency wallet are out of scope (see README open question 3).
- An installment's currency follows its first default wallet and is locked, so "left" never mixes currencies.
- No automatic payments, same as fixed expenses: nothing is paid until you press Pay.
