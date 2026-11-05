# Cross-Currency Purchase Cost

## Intent

Record a purchase exactly as it happened when the store's price, the cash handed over, and the returned change use different currencies. The motivating grocery purchase has an LBP 340,000 cost, a USD 5 tender from a USD wallet, and LBP 110,000 returned to an LBP wallet. The app must store those three facts directly, without deriving an exchange rate, converting the cost, or creating extra visible transactions.

## Goals

- Keep one visible grocery expense with a purchase cost of LBP 340,000.
- Count LBP 340,000 in LBP spending, category totals, budgets, day totals, and exports.
- Debit the selected USD wallet by exactly USD 5.
- Credit the selected LBP wallet by exactly LBP 110,000.
- Display the purchase cost, tender, and every returned amount with their own currencies.
- Preserve atomic create, edit, duplicate, delete, restore, exact-replay, revision, wallet-locking, and archived-wallet behavior.
- Preserve every existing ordinary and cashier transaction without changing its balances or reports.
- Keep English and Arabic behavior aligned.

## Non-goals and anti-goals

- Do not calculate, request, save, or infer an exchange rate for a new purchase.
- Do not derive a hidden LBP 450,000 exchange or any other combined amount.
- Do not create separate income, exchange, or transfer activity for the change.
- Do not support split tender from multiple paying wallets in this change.
- Do not silently convert, round, or compare amounts whose currencies differ.
- Do not redesign ordinary expenses, income, wallet moves, loans, installments, fixed expenses, or pending payments.

## Approaches considered

### Selected: one expense with independent cost and payment currencies

Keep the existing single expense aggregate. The parent amount remains the commercial purchase cost used for reporting. Its paying wallet and cashier settlement remain the source of physical wallet movements. Add an independent cost-currency dimension so the purchase amount can differ from the paying wallet's currency.

This was selected because it represents the event directly, preserves one expense, requires no conversion, and builds on the existing exact tender and multiple-change implementation.

### Alternative: generalized cash-leg ledger

Normalize every tender and return into arbitrary debit and credit legs. This would support future split tender, but it would require a much larger migration of transfers, loans, generated transactions, wallet references, and exports. It is disproportionate to the requested behavior.

### Rejected: linked exchange plus expense

Create an exchange and an LBP expense behind the scenes. This requires deriving LBP 450,000, creates extra records, and makes editing and reporting less direct. It contradicts the requirement to record the three observed amounts without calculation.

## Data model

Add a nullable `cost_currency` to `public.transactions` in a new append-only migration. Existing `transactions.currency` continues to be the paying wallet's currency in storage and remains derived from that wallet. The effective reporting currency becomes `coalesce(cost_currency, currency)`.

For existing rows, `cost_currency` is null, so their meaning is unchanged. For the motivating purchase:

- `amount_minor = 340000`
- `cost_currency = 'LBP'`
- `wallet_id = <USD wallet>`
- `currency = 'USD'`
- `tender_minor = 500`
- one cashier-change child has `amount_minor = 110000`, `currency = 'LBP'`, and the selected LBP wallet

A non-null `cost_currency` that differs from the paying wallet currency is valid only for an ordinary expense with a cashier settlement. It is invalid for income, transfers, loans, generated/source-managed transactions, or an expense with no tender.

The application read model continues to expose `Transaction.amountMinor` and `Transaction.currency` as the purchase/reporting amount and effective cost currency. The settlement snapshot gains a read-only tender currency derived from the payer wallet/storage currency. This keeps reporting code cost-oriented while giving wallet-ledger and cashier-detail code the correct tender denomination.

Write input accepts an optional cost currency. On create, omission means the payer wallet currency. On update, omission preserves the stored effective cost currency so a stale or older editor cannot silently erase a cross-currency purchase. Explicitly selecting the payer currency clears the independent override. Cost currency participates in exact-replay equality, revision changes, financial-change detection, and archived-wallet rules.

## Validation and invariants

- All purchase, tender, and change amounts remain positive integer minor units.
- Wallet ownership, active-wallet requirements, currency locks, deterministic wallet locking, RLS, and aggregate-only settlement writes remain enforced by the database.
- When cost and tender currencies match, retain existing reconciliation:
  - same-currency-only change must satisfy `tender - returned = cost`;
  - if a foreign change leg exists, tender minus same-currency returns must be greater than cost.
- When cost and tender currencies differ, do not compare their numeric values. Validate the cost and every physical cash leg independently.
- A cross-currency cost may have no returned change; paying a foreign-currency amount exactly is a valid observed event.
- Removing cashier settlement is blocked while cost currency differs from the paying wallet currency. The user must first set the purchase currency back to the wallet currency, preventing an unexplained wallet debit.
- Existing historical rate metadata remains readable on unchanged legacy entries, but new or financially changed entries continue to save only actual amounts with no rate.
- Expense breakdown items remain denominated in the effective purchase-cost currency and must not exceed the purchase cost.

## User experience

When **Cash paid and change** is enabled, the form separates three concepts:

1. **Purchase cost**: amount plus a currency selector.
2. **Paid from**: the paying wallet, followed by **Paid to cashier** in that wallet's currency.
3. **Change received**: each exact returned amount, its currency, and its receiving wallet.

The motivating entry is therefore typed directly as LBP 340,000, USD wallet / USD 5, and LBP 110,000 / LBP wallet. No rate field or calculated preview appears.

Changing the purchase currency clears the typed purchase amount because decimal rules may differ; an existing itemized breakdown must be removed first, matching current currency-lock behavior. Changing the paying wallet does not change the purchase currency or cost. If the wallet currency changes, the tender draft is cleared rather than converted; returned-change rows remain exact and independently wallet-backed.

The insufficient-balance warning compares the cashier tender with the paying wallet balance, not the purchase cost. For an ordinary expense without cashier settlement, it continues to compare the expense amount.

Activity and detail views use the purchase cost as the primary amount. Cashier detail shows cost and tender with separate currencies and lists every returned amount. Activity includes a compact secondary cash summary so the user can confirm the USD 5 payment and LBP 110,000 return without opening the detail sheet.

Editing and duplicating hydrate all three facts. Duplicate creates a new aggregate and continues to drop historical rate metadata. Disabling cashier mode while currencies differ shows guidance instead of discarding or converting data.

## Reporting, balances, and export

- `reporting_entries` and `month_category_spend` use the effective cost currency and purchase amount.
- Day totals, category totals, budgets, activity amounts, and expense items use the effective cost currency.
- `wallet_balances` continues to debit `tender_minor` from the paying wallet and credit every cashier-change child; it performs no conversion.
- The export transaction and expense-item views show the purchase cost currency.
- The export wallet ledger uses the payer wallet/tender currency for the tender outflow and each receiver wallet currency for change inflows. Reconciliation must remain zero.
- Monthly operating expense uses the cost currency, while monthly wallet activity uses each physical wallet leg's currency.

## Compatibility and lifecycle

The migration is append-only and does not rewrite existing financial values. Null `cost_currency` preserves all historical semantics. The public RPC signature remains stable; the optional input field is normalized inside the aggregate wrapper before older internal row-writing logic is called or replaced.

Create/update replay snapshots include the effective cost currency. Currency-only edits are financial edits and must lock all old/new wallet roles, reject newly archived participants, increment revision exactly once, and update the creation-receipt final revision as existing code requires. Soft delete and restore retain the settlement children and automatically reverse/reapply the exact USD tender and LBP change.

Direct database writes remain unable to forge another user's wallet, a mismatched change currency, a cross-currency cost without settlement, or a source-managed cross-currency transaction.

## Verification

Implement test-first across these boundaries:

- Settlement unit validation for LBP 340,000 cost, USD 5 tender, and LBP 110,000 change, plus retained same-currency reconciliation.
- Mutation serialization, read hydration, exact replay, omitted-field preservation, edit, duplicate, and settlement removal rules.
- Component tests for purchase-currency selection, payer-wallet changes, breakdown currency locking, tender-based balance warnings, English/Arabic labels, and accessible numeric inputs.
- Database tests proving USD balance `-500`, LBP balance `+110000`, LBP spend `340000`, zero USD spend, no extra income/transfer row, and safe edit/delete/restore/replay behavior.
- Existing archived-wallet, receiver currency-lock, RLS, concurrency, historical-rate, and multi-change tests.
- Export tests proving LBP operating expense, USD tender outflow, LBP change inflow, and zero wallet reconciliation difference.
- End-to-end coverage for entering and reopening the exact motivating purchase on mobile layouts in both locales.
- Full relevant unit, database, end-to-end, typecheck, lint, and build verification.

Before implementation, read the installed Next.js documentation relevant to the touched App Router, server-action, and form/client-component code, as required by `AGENTS.md`.

## Builder decisions

- Choose exact internal helper and column projection names consistent with the existing transaction modules.
- Keep UI controls within the current design system and mobile sheet layout.
- Preserve current RPC lock ordering and wrapper chain while making the smallest safe database-function replacement.
- Update documentation and demo data without replacing the existing multi-change Coffee fixture that anchors regression tests.
