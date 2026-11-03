# 05 · Fixed expense totals per wallet, and salary after fixed

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. No commit steps (owner commits).

**Goal:** The Fixed expenses card shows how much each wallet needs this month, the total of all fixed expenses, and what is left of the salary once they are all paid.

**Owner note:** "Calculate fixed expense for each wallet to know what to put in each wallet (just a number label). Also add a label for total fixed expenses and what will be salary after all are paid."

**Architecture:** Pure client-side arithmetic over data already on Home (`fixed` items, wallets and salary from `useAppData()`). One pure function, `summarizeFixed`, owns the math and is unit-tested; `FixedCard` only renders it. No migration, no new query. Plan 07 extends the same function with installments.

Display (inside the existing card, under the item list):

```
Total fixed        $475.00 · LBP 1,200,000
Per wallet
  Bank   $430.00
  Cash   $45.00        short $22.00     ← only when balance < still unpaid
  Cash   LBP 1,200,000
Salary after fixed $1,325.00
```

**Tech stack:** existing `Amount`, `useAppData`, Vitest.

## Global constraints

All of [README § Global constraints](README.md#global-constraints-every-plan-every-task).

## Review focus

- Salary in USD with LBP fixed items: the LBP items are **not** subtracted (never mix currencies); show "LBP fixed expenses are not included" under the salary line.
- Salary smaller than fixed: negative result shown as "Short by $X" in the over tone with an icon, not a bare minus sign.
- No salary set: the "salary after" line is hidden; per-wallet and total still show.
- A fixed item whose wallet is archived or missing: counted under its currency total, listed as "(archived) Wallet" so the totals still add up.
- Two wallets with the same name and different currencies ("Cash" USD and "Cash" LBP in the demo data): each line shows the currency via its amount.

---

### Task 1: `summarizeFixed`

**Files:**
- Create: `src/features/fixed/summary.ts`, `src/features/fixed/summary.test.ts`

**Interfaces:**
- Consumes: `FixedExpense` (`src/features/fixed/schema.ts`), `Wallet` (`src/features/wallets/schema.ts`), `Currency` (`src/lib/money.ts`).
- Produces:

```ts
export type WalletNeed = {
  walletId: string;
  currency: Currency;
  totalMinor: number;   // all fixed items on this wallet this month
  unpaidMinor: number;  // the part not paid yet
  shortMinor: number;   // max(0, unpaidMinor - wallet balance), 0 if enough
};
export type FixedSummary = {
  byWallet: WalletNeed[];                  // wallet display order (Wallet.position)
  total: Record<Currency, number>;
  left: Record<Currency, number>;          // unpaid, replaces FixedCard's inline loop
  salaryAfter: { currency: Currency; minor: number; excludesOther: boolean } | null;
};
export function summarizeFixed(
  items: FixedExpense[],
  walletById: (id: string) => Wallet | undefined,
  salary: { amountMinor: number; walletId: string } | null,
): FixedSummary;
```

`salaryAfter.minor = salary.amountMinor − total[salaryCurrency]` (can be negative); `excludesOther` is true when the other currency's total is > 0.

- [ ] **Step 1: Write the failing tests** using the demo numbers (Bank USD balance $1,846.30, Cash USD balance $230.00, Cash LBP balance 2,450,000; Rent share $400 Bank paid, Internet $30 Bank unpaid, Generator $45 Cash USD unpaid; salary $1,800 to Bank):

```ts
const s = summarizeFixed(demoItems, walletById, { amountMinor: 180000, walletId: BANK });
expect(s.total).toEqual({ USD: 47500, LBP: 0 });
expect(s.left).toEqual({ USD: 7500, LBP: 0 });
expect(s.byWallet).toEqual([
  { walletId: CASH_USD, currency: "USD", totalMinor: 4500, unpaidMinor: 4500, shortMinor: 0 },
  { walletId: BANK, currency: "USD", totalMinor: 43000, unpaidMinor: 3000, shortMinor: 0 },
]);
expect(s.salaryAfter).toEqual({ currency: "USD", minor: 132500, excludesOther: false });
```

Plus: an LBP item of 1,200,000 on Cash LBP → `total.LBP = 1200000`, `salaryAfter.excludesOther = true`, USD result unchanged; salary $300 → `salaryAfter.minor = -17500`; `salary = null` → `salaryAfter = null`; Cash USD balance $20 with $45 unpaid → `shortMinor = 2500`. (The test builds its own fixtures; `src/lib/demo-data.ts` is `server-only`.)

- [ ] **Step 2:** `pnpm test src/features/fixed/summary.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement. Integer adds only, per currency.
- [ ] **Step 4:** Re-run. Expected: PASS.

### Task 2: Show it on the card

**Files:**
- Modify: `src/components/fixed/fixed-card.tsx` (use `summarizeFixed`; delete the inline `left` loop), `src/messages/en.json`, `src/messages/ar.json`
- Test: `e2e/fixed.spec.ts`

**Strings (`Fixed` namespace):**

| key | en | ar |
| --- | --- | --- |
| `total` | Total fixed | مجموع الثابت |
| `perWallet` | Per wallet | حسب المحفظة |
| `short` | short {amount} | ينقص {amount} |
| `salaryAfter` | Salary after fixed | الراتب بعد الثابت |
| `salaryShort` | Short by {amount} | ينقص {amount} |
| `excludesOther` | {currency} fixed expenses are not included. | المصاريف الثابتة بال{currency} غير محسوبة. |

- [ ] **Step 1: Write the failing test:**

```ts
test("fixed card shows total, per-wallet needs and salary after fixed", async ({ page }) => {
  await page.goto("/en");
  const card = page.getByRole("region", { name: "Fixed expenses" });
  await expect(card.getByText("Total fixed").locator("..")).toContainText("$475.00");
  const perWallet = card.getByRole("list", { name: "Per wallet" });
  await expect(perWallet.getByRole("listitem").filter({ hasText: "Bank" })).toContainText("$430.00");
  await expect(perWallet.getByRole("listitem").filter({ hasText: "Cash" })).toContainText("$45.00");
  await expect(card.getByText("Salary after fixed").locator("..")).toContainText("$1,325.00");
  await expectNoHorizontalOverflow(page);
});
```

Arabic variant: same region in `/ar`, amounts `direction: ltr`.

- [ ] **Step 2:** `pnpm test:e2e e2e/fixed.spec.ts`. Expected: new test FAILS; existing "left to pay" still passes.
- [ ] **Step 3:** Render a summary block under the list (only when `items.length > 0`): a `<dl>` for Total and Salary after; a `<ul aria-label={t("perWallet")}>` with one row per `WalletNeed` (`<bdi>` name, `<Amount>`, and the `short` label in the over tone with an icon when `shortMinor > 0`). Muted 13–15px text; the numbers are the emphasis.
- [ ] **Step 4:** Re-run e2e and `pnpm test`. Expected: PASS. Screenshots at 390px EN/AR.

## Decisions made for the owner

- "What to put in each wallet" counts **all** fixed items this month (paid or not), because that is what the wallet needed. The "short" hint compares the wallet's current balance with what is still unpaid, which answers "do I need to top this wallet up?".
- The salary line lives on the Fixed card, not the Salary card, so all three numbers you asked for sit together.
