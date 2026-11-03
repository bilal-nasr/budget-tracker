# 03 · Confirm before Got salary

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. No commit steps (owner commits).

**Goal:** Pressing **Got salary** always opens a confirmation sheet that names the amount and the wallet; nothing is added until the owner confirms.

**Owner note:** "Got salary button need confirmation popup."

**Architecture:** Today `SalaryCard` (`src/components/salary/salary-card.tsx`) adds the salary on the first press and only shows an inline "Add again" box on a second press in the same month. Replace both with one reusable `ConfirmSheet` (bottom sheet on phones, centered on desktop, via `SheetShell`). The second-in-a-month case keeps its warning as a line inside the same sheet. `ConfirmSheet` is reused by plan 07 (delete installment).

**Tech stack:** existing `SheetShell`, `Button`, next-intl.

## Global constraints

All of [README § Global constraints](README.md#global-constraints-every-plan-every-task).

## Review focus

- Double tap on Confirm must add one salary: the Confirm button is disabled while the action runs.
- Closing the sheet by swipe, backdrop or the X adds nothing.
- The sheet's amount uses `<Amount>` (LTR inside Arabic) and the wallet name is in `<bdi>`.
- Undo toast still appears after confirming (and still works without `router.refresh()`, see plan 01).
- Keyboard: Enter on Confirm confirms; Escape closes; focus returns to the Got salary button.

---

### Task 1: `ConfirmSheet` component

**Files:**
- Create: `src/components/ui/confirm-sheet.tsx`

**Interfaces:**
- Produces:

```ts
export function ConfirmSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;     // body: amount, wallet, warnings
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  pending?: boolean;             // disables Confirm and shows the pending label
  tone?: "default" | "danger";   // danger = destructive button variant (plan 07 delete)
}): React.JSX.Element
```

Footer is a 2-column grid: Cancel (`variant="outline"`) then Confirm (`variant="action"` or `"destructive"`), both `size="lg"`, passed as `SheetShell`'s `footer`.

- [ ] **Step 1:** Implement it. Add it to the kitchen sink (`src/app/[locale]/dev/kitchen-sink/kitchen-sink.tsx`) with a button that opens it.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint`. Expected: PASS.

### Task 2: Got salary asks every time

**Files:**
- Modify: `src/components/salary/salary-card.tsx`, `src/messages/en.json`, `src/messages/ar.json`
- Test: `e2e/salary.spec.ts` (replace the "asks before adding a second time" test)

**Strings (`Salary` namespace):**

| key | en | ar |
| --- | --- | --- |
| `confirmTitle` | Add this month's salary? | إضافة راتب هذا الشهر؟ |
| `confirmBody` | {amount} goes into {wallet} as income. | سيُضاف {amount} إلى {wallet} كدخل. |
| `confirmAlready` | You already added salary on {date}. | لقد أضفت الراتب في {date}. |
| `confirm` | Add salary | أضف الراتب |

`again` and `addAgain` become unused: delete them from both files. (Arabic copy goes through the native-reader review in Phase 7.)

- [ ] **Step 1: Write the failing tests** in `e2e/salary.spec.ts`:

```ts
test("Got salary opens a confirmation with the amount and wallet, Cancel adds nothing", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("region", { name: "Monthly salary" }).getByRole("button", { name: "Got salary" }).click();
  const dialog = page.getByRole("dialog", { name: "Add this month's salary?" });
  await expect(dialog).toContainText("$1,800.00");
  await expect(dialog).toContainText("Bank");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/preview without a database/i)).toHaveCount(0);
});

test("confirming calls the action (preview mode says it cannot save)", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("region", { name: "Monthly salary" }).getByRole("button", { name: "Got salary" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Add salary" }).click();
  await expect(page.getByText(/preview without a database/i)).toBeVisible();
});
```

Plus the Arabic variant: `/ar`, dialog title `إضافة راتب هذا الشهر؟`, amount element computed `direction: ltr`, `expectNoHorizontalOverflow` with the sheet open.

- [ ] **Step 2:** `pnpm test:e2e e2e/salary.spec.ts`. Expected: new tests FAIL.
- [ ] **Step 3:** In `SalaryCard`: replace the `confirming` state and the inline box with `const [confirmOpen, setConfirmOpen] = useState(false)`; Got salary → `setConfirmOpen(true)`; `ConfirmSheet` body shows `confirmBody` with `<Amount>` and `<bdi>{wallet.name}</bdi>`, plus `confirmAlready` (muted, with an info icon) when `status.receivedThisMonth`. Confirm runs the existing `receive()` and closes the sheet when the action returns.
- [ ] **Step 4:** Re-run. Expected: PASS. Run `pnpm test` (message parity) and the whole e2e suite.
- [ ] **Step 5:** Screenshots at 390px, EN and AR, sheet open, light and dark.
