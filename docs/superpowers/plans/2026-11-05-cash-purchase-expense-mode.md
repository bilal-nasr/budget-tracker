# Cash Purchase Expense Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cashier recording a visible secondary Expense mode without creating a new transaction type or changing accounting behavior.

**Architecture:** Reuse the existing `CashSettlementDraft.enabled` state as the single source of truth for `Standard | Cash purchase`. Replace the settlement checkbox with the existing accessible segmented-control pattern, while keeping `CashSettlementFields` responsible only for tender/change details and validation.

**Tech Stack:** Next.js 16.4.5, React 19, TypeScript, next-intl, Testing Library, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-cash-purchase-expense-mode-design.md`

## Global Constraints

- Preserve `Expense | Income | Move` as the only top-level transaction types.
- Default new eligible expenses to Standard; hydrate saved settlements as Cash purchase.
- Preserve exact cost/tender/change values, validation, edit/duplicate semantics, wallet warnings, and database payloads.
- Keep English/Arabic parity, semantic radiogroup behavior, 44px targets, and RTL-safe layout.
- Do not add a database migration, transaction kind, conversion, or exchange-rate behavior.

## Review Focus

- Switching a cross-currency cash purchase to Standard remains blocked until purchase and payer currencies align; Task 1 pins it.
- Changing transaction type while Cash purchase is active retains the existing safe-removal error; Task 1 pins it.
- Edit and duplicate open in Cash purchase mode without altering saved legacy rate metadata; Task 1 pins it.
- A Standard expense remains the quickest default path and sends no settlement; Task 1 pins it.
- English and Arabic expose equivalent mode names and selected states without horizontal overflow; Task 1 pins it.

---

### Task 1: Replace the hidden cashier toggle with an Expense sub-mode

**Files:**
- Modify: `src/components/add/transaction-sheet.tsx`
- Modify: `src/components/add/cash-settlement-fields.tsx`
- Modify: `src/components/add/cash-settlement-fields.test.tsx`
- Modify: `src/components/add/transaction-breakdown.test.tsx`
- Modify: `src/components/add/transaction-sheet.test.tsx`
- Modify: `src/messages/en.json`
- Modify: `src/messages/ar.json`
- Modify: `src/messages/messages.test.ts`
- Modify: `e2e/cashier.spec.ts`

**Interfaces:**
- Consumes: `CashSettlementDraft.enabled` and `Segmented`.
- Produces: Expense-only `standard | cashPurchase` presentation mapped directly to `enabled: false | true`.
- Preserves: `CashSettlementFields` tender/change parsing and `TransactionInput` payload shape.

- [ ] **Step 1: Write failing component tests** asserting new expenses show `Standard | Cash purchase` with Standard selected, selecting Cash purchase reveals purchase currency/tender/change controls, and the old checkbox is absent.
- [ ] **Step 2: Write failing edit tests** asserting saved cashier expenses and duplicates select Cash purchase, safe cross-currency removal is blocked, and aligned removal sends `costCurrency` plus `settlement: null`.
- [ ] **Step 3: Write failing bilingual tests** asserting matched English/Arabic labels and radiogroup semantics.
- [ ] **Step 4: Run** `pnpm exec vitest run src/components/add/transaction-sheet.test.tsx src/components/add/transaction-breakdown.test.tsx src/components/add/cash-settlement-fields.test.tsx src/messages/messages.test.ts` and confirm RED because the secondary mode does not exist.
- [ ] **Step 5: Implement the secondary `Segmented` control** directly below the top-level type control for eligible expenses, mapping selection to `cashDraft.enabled` while preserving existing removal guards and type-change rules.
- [ ] **Step 6: Remove the enable checkbox from `CashSettlementFields`** and render only the expanded payment-detail content when the parent selects Cash purchase; retain its heading, parser, errors, and change-row controls.
- [ ] **Step 7: Add English/Arabic copy** for `paymentStyle`, `standard`, `cashPurchase`, and cross-currency removal guidance.
- [ ] **Step 8: Update cashier E2E selectors and add the exact LBP 340,000 / USD 5 / LBP 110,000 mode-selection path.**
- [ ] **Step 9: Run the focused tests** from Step 4 and confirm GREEN.
- [ ] **Step 10: Run full verification:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm exec next build --webpack`, and supported Playwright cashier projects.
- [ ] **Step 11: Run** `git diff --check`, inspect the diff, request a fresh code review, fix any Critical/Important findings, and commit on `main` with message `feat: surface cash purchases within expenses`.
