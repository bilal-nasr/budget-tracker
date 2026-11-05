# Add Transaction Wallet Balances

## Intent

When adding an expense, income, or wallet move, show the current balance of every selected wallet so the user can confirm available funds and destination context without leaving the composer.

## Goals

- In add mode, show a muted, localized balance line directly beneath the selected wallet control.
- Expense and income show the balance of their one selected wallet.
- Move shows balances beneath both the From and To wallet selectors.
- Update the displayed balance immediately when a wallet selection changes.
- Format each balance with the app's existing money component so currency, sign, grouping, and digit preferences stay consistent.

## Non-goals and constraints

- Do not calculate a projected post-transaction balance while the amount is being entered.
- Do not add balances to wallet option lists.
- Do not change wallet data loading or transaction submission behavior.
- Keep the existing mobile layout and accessibility labels intact.
- Do not add the balance display to transaction editing; this request is scoped to adding.

## Approaches considered

1. **Muted line beneath each selected wallet control (chosen).** Clear on mobile, keeps wallet names readable, and maps naturally to both sides of a move.
2. Put the balance inside each wallet control. More compact, but crowds long wallet names and currencies.
3. Show balances in every wallet option. Useful for comparison, but adds visual noise and exceeds the requested selected-wallet context.

## Implementation and verification

Render localized balance labels from the selected `Wallet.balanceMinor` values in the existing client-side transaction form. Use the shared `Amount` component for formatting. Add component tests that first fail without the new display, then verify expense/income selection and both Move selections update the correct balances in English and Arabic. Run the focused test, full Vitest suite, typecheck, and lint.
