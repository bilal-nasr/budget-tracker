# Cash Purchase Expense Mode

## Intent

Make cashier recording discoverable without presenting it as a separate transaction type. A cashier purchase remains one expense; the secondary mode only changes which payment details the expense form shows.

## Goals

- Keep the primary transaction types `Expense | Income | Move`.
- When Expense is selected, show a prominent secondary choice: `Standard | Cash purchase`.
- Default new expenses to Standard so the fastest common entry remains unchanged.
- Selecting Cash purchase immediately reveals purchase currency, paid amount, and returned-change controls.
- Hydrate saved cashier expenses directly into Cash purchase mode on edit or duplicate.
- Preserve the exact cost/tender/change payload, currency rules, validation, wallet warnings, breakdown behavior, Arabic parity, and mobile accessibility.

## Non-goals

- No new transaction kind, route, database column, calculation, or exchange-rate behavior.
- No redesign of Income, Move, Breakdown, or transaction details.
- No automatic conversion between purchase and payer currencies.

## Approaches considered

1. **Fourth top-level `Cashier` tab.** Most visible, but incorrectly makes a payment method look like a transaction type and creates “Expense or Cashier?” ambiguity.
2. **Existing checkbox below the form.** Semantically correct but too easy to miss below the fold, especially when cost and wallet currencies differ.
3. **Secondary Expense mode: `Standard | Cash purchase` (chosen).** Keeps the correct information hierarchy while making the richer flow visible near the amount.

## Interaction design

- Render the secondary two-option segmented control immediately below the primary transaction-type control whenever Expense is active and eligible for cashier settlement.
- `Standard` means no cashier settlement. `Cash purchase` means the existing settlement draft is enabled.
- For a new expense, Standard is selected initially. For edit/duplicate, derive the mode from whether a settlement exists.
- Changing Cash purchase to Standard uses the existing safe removal rules: a cross-currency purchase must first align its purchase currency with the payer currency, and saved settlement removal remains explicit.
- Remove the redundant cashier enable checkbox. The expanded section keeps a descriptive heading and its existing tender/change fields.
- In Cash purchase mode, place the paying-wallet selector inside the cash-paid section, immediately before the tender amount. The purchase-cost header shows only the cost, so the wallet cannot be mistaken for the purchase currency or cost account.
- Use bilingual labels `Standard` / `Cash purchase` and clear Arabic equivalents. Keep 44px minimum targets, visible selected state, semantic radiogroup behavior, and RTL-safe layout.

## Verification

- Component tests first: new Standard default, switching to Cash purchase, exact LBP 340,000 / USD 5 / LBP 110,000 payload, edit/duplicate hydration, safe removal, English/Arabic labels, and no regression to balance warnings or breakdown currency.
- Run focused component/message tests, then the full unit suite, typecheck, lint, and production build.
