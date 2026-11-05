# Add Transaction Wallet Balances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the current balance of each selected wallet while adding expenses, income, and wallet moves.

**Architecture:** Keep the behavior inside the existing client-side transaction form because `useAppData()` already supplies live `Wallet.balanceMinor` values and selection state. Render the shared `Amount` component beneath the relevant wallet control, guarded by add mode and the presence of a selected wallet, with a localized `Add.balance` label.

**Tech Stack:** Next.js 16.4 client components, React 19, TypeScript, next-intl, Vitest, Testing Library

**Spec:** `docs/superpowers/specs/2026-11-05-add-transaction-wallet-balances-design.md`

## Global Constraints

- Display current balances only; do not calculate projected post-transaction balances.
- Do not show balances in wallet option lists or change wallet loading/submission behavior.
- Preserve the existing responsive layout and accessibility labels.
- Limit the new balance display to add mode.
- Format values with the shared `Amount` component and localize the label in English and Arabic.

## Review Focus

- A negative wallet balance must keep its minus sign and currency formatting.
- Changing an expense/income wallet must replace the old displayed balance immediately.
- A Move destination with no selection must not show a fabricated zero balance.
- Changing either side of a Move must update only that side's displayed balance.
- Edit mode must not gain the add-only balance display.

---

### Task 1: Selected wallet balance display

**Files:**
- Modify: `src/components/add/transaction-sheet.test.tsx`
- Modify: `src/components/add/transaction-sheet.tsx`
- Modify: `src/messages/en.json`
- Modify: `src/messages/ar.json`

**Interfaces:**
- Consumes: `Wallet.balanceMinor`, `Wallet.currency`, the existing `wallet`, `toWallet`, `walletId`, `toWalletId`, and `ComposerState` values in `Form`; `Amount({ minor, currency, className? })` from `src/components/money/amount.tsx`.
- Produces: localized `Add.balance` text and add-only balance rows beneath the expense/income wallet button and both selected Move wallet controls.

- [ ] **Step 1: Write failing component tests**

Extend the wallet fixtures with distinct literal balances, including one negative balance. Make the test mount helper accept add mode/preset and optional edit state. Add tests named:

- `shows and updates the selected balance for expense and income` — assert the initial literal formatted balance, switch wallets, assert the replacement balance and absence of the old value, switch to Income, and assert the selected balance remains visible.
- `shows and independently updates both selected Move wallet balances` — assert the From balance, assert no To balance before selection, select a destination and assert its balance, then change each side and assert both current literal balances.
- `formats a negative selected wallet balance` — select the negative fixture and assert the shared money format includes the minus sign and currency.
- `does not show selected wallet balances while editing` — mount an edit state and assert no localized balance label.

Use accessible text/labels rather than implementation-only test IDs. The production mutations these tests catch are removing the add-mode guard, binding a row to the wrong wallet, retaining a stale balance after selection, or formatting `balanceMinor` as a raw number.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm test src/components/add/transaction-sheet.test.tsx`

Expected: FAIL because the localized balance rows do not exist yet.

- [ ] **Step 3: Add localized copy**

Add `"balance": "Balance"` to `Add` in `src/messages/en.json` and `"balance": "الرصيد"` to `Add` in `src/messages/ar.json`.

- [ ] **Step 4: Implement the minimal balance rows**

Import `Amount` into `transaction-sheet.tsx`. In `Form`, render a muted `<p>` containing `t("balance")`, a separator, and `<Amount minor={selected.balanceMinor} currency={selected.currency} />`:

- Under the expense/income wallet button when `state.mode === "add"` and `wallet` exists.
- Under the Move From selector when `state.mode === "add"` and `wallet` exists.
- Under the Move To selector when `state.mode === "add"` and `toWallet` exists.

Wrap each Move selector and its row together so the existing responsive two-column grid remains intact. Do not add a row for an unselected destination.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm test src/components/add/transaction-sheet.test.tsx`

Expected: all tests in the file PASS with no warnings.

- [ ] **Step 6: Run project verification**

Run: `pnpm test`

Expected: full Vitest suite PASS.

Run: `pnpm typecheck`

Expected: Next.js type generation and TypeScript checks PASS.

Run: `pnpm lint`

Expected: ESLint PASS.

- [ ] **Step 7: Commit the implementation**

```bash
git add src/components/add/transaction-sheet.test.tsx src/components/add/transaction-sheet.tsx src/messages/en.json src/messages/ar.json
git commit -m "feat: show selected wallet balances in add sheet"
```
