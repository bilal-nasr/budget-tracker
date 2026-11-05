# Global currencies in every wallet — design revision

**Date:** 2026-11-05  
**Status:** Proposed  
**Supersedes:** The per-wallet currency opt-in, add-balance, and detach-balance behavior in `2026-11-05-custom-currencies-multi-wallets-design.md` and its implementation plan. All unaffected accounting, history, Move/Exchange, ordering, deletion, localization, and precision requirements remain in force.

## Intent

Currencies are global account settings. When a user adds or enables a currency, it automatically becomes available in every non-deleted wallet. A user should never have to add the same currency separately to Pocket, Bank, Cash, or another wallet.

Each wallet still has one preferred default currency. That default is preselected when an action starts from the wallet, and the user may switch to any other enabled global currency.

## Goals

- Adding or enabling a global currency atomically makes it available in every non-deleted wallet.
- Creating a wallet atomically gives it one balance for every enabled global currency.
- Each wallet/currency pair has one durable exact balance identity.
- Disabling is allowed only when the currency is zero in every wallet and has no unresolved configuration or future-writing dependency.
- Disabled balances remain stored for history, are hidden from ordinary wallet/action views, and reappear with the same IDs when re-enabled.
- Existing Move, Exchange, wallet ordering, hard deletion, runtime precision, and historical snapshot rules remain exact.

## Non-goals

- No per-wallet currency add/remove or detach controls.
- No virtual or lazily created balances.
- No conversion or combined wallet total.
- No automatic exchange rate or value conversion.
- No retroactive mutation of deleted wallet tombstones.

## Approaches considered

### 1. Eager durable balances — selected

Every non-deleted wallet has a durable balance row for every enabled currency. Global add/enable and wallet creation maintain this invariant atomically.

This was selected because it directly matches the requested behavior, gives every Move/Exchange selector an exact destination balance ID, and avoids partial or eventual application.

### 2. Virtual zero balances — rejected

The UI could display enabled currencies that do not yet have database rows, creating a row only on first use. This saves rows but complicates exact destination selection, concurrency, history, and failure recovery.

### 3. Background synchronization — rejected

A background job could add balances after currency or wallet creation. This permits partial states and temporarily missing destination currencies, which conflicts with the requested automatic behavior and accounting invariants.

## Data invariants

For every wallet whose `deleted_at` is null, including a Needs-attention wallet:

- exactly one `wallet_balances` row exists for every enabled `currencies` row owned by the same user;
- the balance row keeps a stable UUID for its lifetime;
- the wallet default points to one of its enabled currency balances;
- no enabled currency balance is detached or hidden;
- additional disabled-currency balances may remain for history and reuse.

Deleted wallet tombstones retain their existing balances and snapshots but do not receive newly added currencies.

The global currency catalog remains owner-scoped. Code validation, symbol validation, and decimal precision remain unchanged: code is normalized uppercase, symbol is 1–12 Unicode code points, and precision is 0–8.

## Currency lifecycle

### Add

Adding a currency is one transaction:

1. validate and insert the owner-scoped catalog definition;
2. create a zero balance with a stable UUID in every non-deleted wallet;
3. leave all existing wallet defaults unchanged;
4. return only after the invariant is complete.

The currency settings screen reflects the new currency immediately. Partial insertion is impossible.

### Edit

Auto-created zero balances do not by themselves make a definition “used.” Code and precision remain editable until the currency has actual monetary or configuration use. Symbol remains editable afterward.

Changing an unused code updates its automatically created zero balances atomically. A definition becomes used when it receives a non-zero opening/current amount, appears in monetary history, or is referenced by a configuration that can write future money.

### Disable

Disable remains an atomic global operation. It is blocked while any of these are true:

- any wallet balance for the currency is non-zero;
- an unresolved salary, fixed expense, installment, loan, pending payment, current budget, or future budget depends on it;
- it is the last enabled global currency;
- an affected non-deleted wallet cannot switch to another enabled default.

On success, every affected wallet default switches deterministically to the next enabled currency in global catalog addition order, wrapping cyclically. The disabled balance rows remain stored with the same IDs but disappear from ordinary wallet views and new-money selectors.

Historical reads continue resolving the disabled currency definition and exact balance identity. Mutations that would create or restore money in a disabled currency remain rejected.

### Re-enable

Re-enabling reveals the same preserved balance rows in every non-deleted wallet. It does not change wallet defaults. If an exceptional legacy wallet is missing the row, the operation creates the missing zero balance atomically before returning.

### Delete

Only a never-used currency may be deleted. Deletion removes its automatically created zero balance rows from non-deleted wallets and the catalog definition in one transaction. A used currency is preserved and may only be disabled.

## Wallet lifecycle

### Create

Wallet creation accepts name, kind, a chosen default currency, and an optional signed opening amount for that default currency. The UI preselects the first enabled catalog currency unless the user chooses another.

The database transaction creates:

- the wallet container;
- one balance for every enabled currency;
- the selected default pointer;
- the opening amount only on the selected default balance; every other balance starts at zero.

### Display and selection

The selected Currency-view UX uses a global enabled-currency selector. Wallet cards show the exact balance for the selected currency across all wallets. A wallet's own default is used when opening an action from that wallet and is clearly marked in wallet settings.

Users may change a wallet default to any enabled currency. There is no per-wallet add, restore, detach, or remove currency control.

### Delete

Guided hard deletion continues to require settlement of every non-zero balance. Because every other active wallet has every enabled currency, each settlement counterpart can be selected by wallet; the exact destination balance ID is resolved from the shared currency.

Positive balances move out, negative balances receive funds, all legs remain atomic and exact, and the wallet is tombstoned only after all its balances are zero. Deleted wallets never receive later catalog additions.

## Move and Exchange

- **Move:** source and destination are different wallet containers. Same-currency Moves transfer equal minor units. Cross-currency Moves are allowed when the user provides both exact amounts/rate data required by the existing transaction rules.
- **Exchange:** source and destination balances belong to the same wallet and have different enabled currencies.
- Same-balance operations remain invalid.
- New operations cannot select disabled currencies or deleted wallets.

Since every enabled currency exists in every active wallet, selectors no longer suppress destination wallets because a balance is missing. They still use exact balance IDs and never create a balance implicitly during a Move or Exchange.

## Database revision

The already committed per-wallet migration remains immutable. A new forward migration will revise it:

- backfill every missing enabled currency balance across all non-deleted wallets at zero;
- preserve all existing balance UUIDs, amounts, defaults, ordering, snapshots, and tombstones;
- replace per-wallet add/detach invariants with the global coverage invariant;
- add owner-serialized RPCs for currency create/update/delete/enable/disable and wallet creation;
- make global currency and wallet creation enforce full coverage before commit;
- stop auto-created zero balances from marking a currency used;
- retain deterministic owner/catalog/wallet/balance lock ordering;
- reject direct DML that would leave incomplete enabled-currency coverage.

The revision requires pgTAP and deterministic two-connection coverage for currency add versus wallet create/delete, currency enable versus wallet create, currency delete versus first monetary use, disable versus new money, and default switching versus catalog changes.

## Application revision

- Currency settings continue to add, edit, enable, disable, and delete global definitions.
- Successful add/enable immediately updates every active wallet view.
- Wallet management removes add/detach balance controls and keeps default selection only.
- Provider indexes retain complete catalog/history lookups while ordinary enabled-balance views hide disabled currencies.
- Data access no longer exposes per-wallet add/reactivate/detach actions.
- The Currency-view wallet screen uses global currency selection and exact per-wallet balance rows.

## Error and recovery behavior

All global operations are transactional. A failure in any wallet rolls back the entire catalog or wallet operation. Stable errors distinguish invalid input, unavailable currency/wallet, non-zero currency, active dependency, last enabled currency, used definition, and concurrent catalog/wallet changes.

Settings and wallet sheets remain open on failure. They refresh from server state after success and never optimistically claim a global operation completed before the database commits.

## Migration of the active implementation plan

Before feature work resumes:

1. add a database-revision task that establishes global coverage and replaces per-wallet lifecycle RPCs;
2. revise data-access and currency-settings tasks to use global currency RPCs and immediate refreshed state;
3. replace the wallet UX task with Currency-view behavior and default-only wallet settings;
4. update Move/Exchange and wallet-deletion tasks to resolve universally present enabled balances;
5. retain later feature, export, compatibility-removal, and full-verification tasks with exact balance IDs.

No cloud migration is applied until the revised local migration chain, concurrency suites, application tests, and end-to-end verification pass.
