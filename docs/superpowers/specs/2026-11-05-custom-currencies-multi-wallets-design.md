# Custom currencies and multi-currency wallets design

## Status

This design supersedes `2026-11-05-custom-currencies-design.md`. No implementation from the earlier plan has started. The replacement implementation plan must cover this document as one coordinated migration.

## Intent

Let each user define the currencies they use and let one real-world wallet hold several of those currencies. A wallet such as **Pocket** should remain one recognizable, orderable object while keeping independent USD, LBP, EUR, or other balances underneath it. Money must always retain an exact currency and integer minor-unit amount; neither the UI nor the database may combine balances from different currencies.

## Goals

- Retain the approved user-owned currency catalog: custom code, symbol, and 0-8 decimal places.
- Turn a wallet into a container with one or more separate currency balances.
- Give every active wallet one enabled default currency balance that is preselected in transaction forms.
- Let the user switch to another balance contained in that wallet without changing wallets.
- Allow explicit cross-currency transfers only between balances that already exist in the selected source and destination wallets.
- Never create a destination balance implicitly during a transfer or wallet deletion.
- Let users manually reorder wallets; use that order consistently in wallet screens and wallet selectors.
- Provide a guided wallet-deletion flow that transfers every non-zero balance before removal.
- Remove a deleted wallet from active UI while keeping its name and past activity understandable.
- Make global currency disabling safe across all wallet balances and defaults.
- Migrate all existing wallets, transactions, and USD/LBP/SYP data without changing any amount.

## Non-goals

- No combined or converted “total wallet value” across currencies.
- No automatic exchange rates, live rates, or inferred conversion.
- No implicit creation of a wallet balance when receiving money.
- No per-screen wallet order; there is one owner-defined wallet order.
- No custom ordering of balances inside a wallet in this version. The default appears first, followed by the order in which balances were added.
- No deletion of financial activity when a wallet disappears from the active wallet list.
- No global currency disable that silently moves, converts, or discards money.

## Anti-goals

- Do not model a multi-currency wallet as unrelated hidden wallets grouped only in the UI.
- Do not keep currency on the wallet container after balances are introduced.
- Do not let a transaction refer only to a container when the exact balance is knowable.
- Do not auto-select a destination currency that the destination wallet does not contain.
- Do not let global currency settings leave an active wallet with no enabled default balance.
- Do not treat a zero current balance as permission to erase historical transactions.

## Approaches considered

### Selected: wallet container with child currency balances

`wallets` stores the real-world container and its display order. `wallet_balances` stores one row per currency held by that wallet, including its opening amount and stable identity. Monetary records reference the exact balance used. This makes defaults, switching, transfer validation, balance calculation, and concurrency rules explicit.

### Rejected: composite `(wallet_id, currency)` as the balance identity

This avoids a balance UUID but spreads composite references through every monetary table and RPC. Renaming a still-unused custom currency, detaching a balance, and preserving historical references become more fragile. A stable balance ID is clearer and safer.

### Rejected: keep single-currency wallets and group them visually

This is a smaller migration, but “Pocket” would not be a real database entity. Ordering, editing, deletion, defaults, reporting, and wallet-level history would behave inconsistently.

## Currency catalog

The approved per-user `currencies` table remains:

- `(user_id, code)` primary key;
- `symbol`;
- `decimal_places` from 0 through 8;
- durable `first_used_at`;
- `disabled_at`;
- `created_at`.

Codes match `^[A-Z][A-Z0-9]{0,11}$`, symbols contain 1-12 Unicode code points, and formatting preserves the approved symbol-spacing rule. USD, LBP, and SYP are bootstrapped for every user. Code and decimal places lock permanently on first use; symbol remains editable.

An enabled currency may be added to any active wallet at most once. A disabled currency cannot be added to a wallet or used for new money records.

## Wallet and balance data model

### Wallet container

`wallets` becomes:

- `id uuid` primary key;
- `user_id uuid` owner;
- `name text`;
- `kind wallet_kind` (`cash`, `bank`, `card`);
- `default_balance_id uuid` referencing one balance owned by the same wallet;
- `position integer` forming a dense, owner-scoped active order;
- `deleted_at timestamptz` for removal from active use;
- `created_at timestamptz`.

The container no longer stores `currency`, `opening_balance_minor`, or `archived_at`. The existing archive experience is replaced by deletion from active use with retained historical identity. A wallet with active templates or obligations must resolve those references before deletion.

### Wallet currency balance

Add `wallet_balances`:

- `id uuid` primary key;
- `user_id uuid` owner;
- `wallet_id uuid` referencing the container;
- `currency text` referencing `(user_id, currencies.code)`;
- `opening_balance_minor bigint`;
- `position integer` recording addition order;
- `detached_at timestamptz` for a zero balance removed from future use but retained for history;
- `created_at timestamptz`;
- unique `(wallet_id, currency)` across live and detached history.

The balance ID is stable and is the accounting identity. Current balance is derived from its opening amount and all transaction legs that reference it. A balance with history may be detached only at zero; it remains queryable for history and prevents silently reusing the same wallet/currency identity. Re-adding that currency restores the detached balance rather than creating a second historical identity.

Every active wallet must have at least one attached, enabled balance. `default_balance_id` must point to an attached, enabled balance owned by that wallet.

## Existing-data migration

The migration is forward-only and atomic:

1. Create/backfill each user's USD, LBP, and SYP currency definitions.
2. Create one balance for every existing wallet using its current currency and opening balance.
3. Set each wallet's new default to that balance and preserve its current ordering.
4. Add exact source/destination/change balance references to monetary records and backfill them from their existing wallet and stored currency facts.
5. Update salary, fixed expense, installment, loan, pending receipt, cashier settlement, and all other wallet references to the required container and/or exact balance identity.
6. Rebuild balance views, functions, triggers, and RPCs around balance IDs.
7. Convert the currency enum to validated catalog text as specified in the earlier approved design.
8. Drop obsolete wallet-level currency/opening/archive columns only after verification.

No stored amount is rescaled. Soft-deleted transactions, archived wallets, snapshots, replay payloads, and historical change legs participate in backfill and validation.

Existing archived wallets migrate as follows: a zero-balance archived wallet becomes a tombstoned historical wallet; an archived wallet with any non-zero balance or unresolved active dependency remains hidden from normal selectors but appears in a dedicated **Needs attention** section where the user can resolve balances/dependencies and complete deletion. The migration never silently reactivates or discards an archived wallet.

## Wallet list UX

Use the selected **Wallet balances** direction from the approved local mockup:

- One card/row per wallet, ordered by `position`.
- Wallet name and kind remain the primary identity.
- The default currency amount is prominent.
- Other attached currency balances appear underneath as compact rows.
- The default is marked without relying on color alone.
- No combined total appears.
- A one-currency wallet stays compact; additional rows appear only when needed.
- Deleted wallets do not appear in the wallet list or new-entry selectors.

The wallet screen has a **Reorder** action. Reorder mode uses accessible drag handles plus keyboard controls; saving writes a dense global order. Concurrent create, delete, restore-equivalent operations, and reorder serialize through one owner-scoped database lock, following the existing category-ordering precedent.

## Wallet editing and balance management

Creating a wallet requires name, kind, first enabled currency, opening amount, and optionally which existing balance funds that opening amount. The first balance becomes the default.

Editing a wallet allows:

- rename and kind change;
- add an enabled currency balance with zero or explicitly funded opening amount;
- set any attached enabled balance as default;
- detach a zero balance that is not the only attached enabled balance;
- begin wallet deletion.

Adding a balance never takes money implicitly. If the user chooses to fund it from another balance, record an explicit transfer with actual sent and received amounts. Cross-currency funding requires both exact amounts and uses no inferred rate except the existing optional USD/LBP remembered memo.

Balance detachment is blocked while its current balance is non-zero. Active salary/fixed/installment/loan/pending configurations tied to that balance must be moved or removed first. Historical activity remains visible through the detached balance.

Re-adding a detached balance restores the same balance identity at zero. It cannot receive a new opening amount because that would rewrite its historical basis; money enters only through a new explicit income or transfer.

## Default currency behavior

New transaction forms preselect the selected wallet's `default_balance_id`. The currency switcher shows only attached, enabled balances in that wallet, default first and then balance addition order. Switching currency changes the exact balance ID and resets/revalidates typed amounts using its precision.

When a user explicitly changes a wallet's default, the choice persists everywhere. A default is never inferred from the largest balance or most recent transaction.

If a global currency is being disabled and is a wallet default, the database switches that wallet to the first eligible balance after it in addition order, wrapping to the earliest eligible balance when necessary. This happens only after all disable preconditions pass. If no such balance exists, disabling remains blocked until the user adds another enabled currency to the wallet or deletes the wallet.

## Transfers and cross-currency moves

Product terminology is strict:

- **Move** means money travels between two different wallet containers. A move may keep the same currency or use different currencies when both selected balances already exist.
- **Exchange** means money changes between two different currency balances inside the same wallet container.

Both operations share the same two-leg accounting primitive, but headings, buttons, Activity labels, filters, and accessibility names use the correct product term.

A transfer has an exact source balance and destination balance:

- Source wallet selection preselects its default balance; the user may switch among currencies actually held by that wallet.
- Destination wallet choices exclude deleted wallets. The source wallet remains available only when it contains another eligible balance.
- After selecting a destination wallet, the receiving-currency control shows only attached, enabled balances that already exist in that destination wallet.
- Cross-currency moves are allowed when the selected source and destination balances have different codes.
- The user enters the exact sent and received amounts. Only USD/LBP may offer the existing remembered-rate convenience; the actual recorded legs remain authoritative.
- Same-currency moves require equal integer minor amounts.
- No transfer path creates or restores a destination balance implicitly.

Same-wallet exchange is allowed: source and destination may share a wallet container as long as they are distinct balance IDs with different currency codes. A same-wallet, same-currency move is meaningless and rejected. Destination-wallet exclusion therefore applies only when it would select the exact same source balance; the current wallet remains selectable when it contains another eligible currency balance.

Cashier change and all other flows that select a receiving wallet follow the same rule: the receiving wallet must already contain the selected receiving currency balance.

## Wallet deletion

The product action is labeled **Delete wallet** and removes the wallet from active UI. The database retains a tombstoned container and its balance identities so Activity, exports, replay protection, and accounting audits keep the historical wallet name and exact legs. This is permanent from the user's perspective; there is no archived-wallet list or restore action.

Deletion behavior:

1. Lock the wallet and all attached balances.
2. If every balance is zero and there are no unresolved active dependencies, confirm and delete from active use immediately.
3. If any balance is non-zero, open a guided transfer flow listing each non-zero currency.
4. For each positive balance, destination choices include only other active wallets already containing an attached enabled balance in the same currency. The flow transfers the full amount out.
5. For each negative balance, the direction reverses: the user chooses an attached enabled balance in the same currency from another active wallet and transfers exactly enough into the wallet being deleted to settle it to zero.
6. If no eligible counterpart exists for a balance, explain that the user must add that currency to another wallet first.
7. Execute all same-currency settlement transfers and wallet tombstoning in one idempotent database transaction. A failure leaves the wallet and every balance unchanged.

The guided deletion flow transfers full balances only. It does not let the user enter partial amounts or exchange during deletion. Cross-currency exchange remains available in the ordinary Move flow before retrying deletion.

## Global currency disabling

Disabling a catalog currency is a database transaction with strict preconditions:

- Every attached or detached wallet balance in that currency must have current balance zero.
- No active salary, fixed expense, installment, loan, pending payment, budget, or other future-writing configuration may require that currency without being resolved.
- Every active wallet that currently defaults to that currency must have another attached enabled balance.
- Wallets with more than one eligible balance automatically switch to the next eligible balance in cyclic addition order.
- A wallet with only the currency being disabled blocks the operation even at zero until the user adds another enabled balance or deletes the wallet.

If any precondition fails, nothing changes. The UI presents a structured blocker list by wallet/configuration instead of a generic failure. On success, the currency disappears from all creation controls but historical definitions and zero balances remain renderable. Re-enabling restores eligibility but does not change wallet defaults automatically.

After a currency is disabled, any historical mutation that would make one of its wallet balances non-zero is rejected. Metadata-only corrections that do not affect ledger amounts or balance references remain allowed. Re-enabling the currency restores ordinary edit/delete/restore behavior.

## Ordering

Wallet order is global per user and is used in:

- Wallets;
- home summaries that list wallets;
- all wallet selectors;
- transfer source/destination choices;
- salary, fixed, installment, loan, pending receipt, and cashier-change wallet choices.

Within a wallet, the default balance appears first. Remaining attached balances follow immutable addition position; detached or disabled historical balances appear only in history/detail contexts.

New wallets append to the end. Deleting compacts active positions. Reordering uses a single RPC with the complete ordered list, validates exact ownership/membership, rejects duplicates/missing IDs, and serializes with concurrent wallet mutations.

## Application model

Introduce:

- `Wallet { id, name, kind, position, deleted, defaultBalanceId, balances }`;
- `WalletBalance { id, walletId, currency, openingBalanceMinor, balanceMinor, position, detached }`;
- runtime `CurrencyDefinition` from the superseded custom-currency design.

Forms pass balance IDs, not wallet IDs plus guessed currencies. Presentation may show `Wallet name · Currency code`, but mutations and query validation resolve the exact owner-controlled balance. Query mappers fail visibly if a referenced balance, wallet, or currency definition is missing.

All totals become runtime maps keyed by currency code and sum balance rows, never wallet containers. Exports include wallet container columns, balance ID/currency columns, tombstoned wallet names, and exact per-currency values.

## Database integrity and concurrency

- RLS limits wallet containers, balances, and catalog definitions to `auth.uid()`.
- Composite ownership checks prevent cross-tenant balance references.
- A wallet/balance integrity trigger validates default ownership, attached/enabled state, and immutable ownership.
- Monetary creation locks selected currency definitions and balance rows before checking enabled/attached state.
- Balance creation/restoration locks both wallet and catalog definition.
- Default changes, detach, delete, transfer, disable, and reorder use deterministic lock ordering.
- Transaction snapshots retain currency code and wallet name needed for durable export/activity display, while balance IDs remain authoritative.
- Replay/idempotency payloads include exact source/destination balance IDs and reject reuse with changed selections.
- Tombstoning a wallet is impossible while a concurrent new reference is committing.
- After a wallet is tombstoned, monetary legs touching any of its balances are immutable: they cannot be edited, deleted, restored, or repointed. Metadata-only corrections that leave every ledger leg unchanged may remain available. This keeps the zero-at-deletion invariant permanent while preserving readable history.

## Error handling

Expose stable errors for invalid/foreign balance, balance missing currency, disabled currency, non-zero balance, unresolved dependency, no eligible destination, invalid default, last wallet balance, reorder conflict, and wallet deletion conflict. User messages name the wallet/currency the user can act on without exposing another tenant's data.

Missing catalog or balance data is an unavailable-state error, never a fallback to USD or the wallet default.

## Testing and verification

- Unit tests: wallet/balance schemas, default selection, runtime totals, custom precision, next-added default choice, disabled filtering, and missing-reference failures.
- Component tests: recommended wallet-card layout, one/many balances, currency switcher reset behavior, add/detach/default actions, reorder keyboard/drag behavior, disable blocker lists, and guided deletion.
- Server action tests: exact balance IDs, tenant isolation, stable errors, idempotency, and revalidation.
- pgTAP: migration preservation, RLS, balance ownership, default invariants, transfer compatibility, detach/delete rules, global disable preconditions, tombstone history, and order density.
- Two-connection tests: transfer versus detach/delete, new reference versus wallet tombstone, disable versus new money, default switch versus balance detach, and reorder versus create/delete.
- End-to-end in English and Arabic:
  - migrate/display existing single-balance wallets;
  - add EUR to Pocket and make it default;
  - preselect default then switch to USD during entry;
  - cross-currency move only into a balance already present at destination;
  - reorder wallets and verify selector order;
  - block delete when a destination lacks the required currency;
  - add the destination balance, run guided emptying, and verify Activity history survives deletion;
  - block global disable with non-zero balances or a last-only wallet;
  - satisfy blockers, auto-select next-added defaults, and disable successfully;
  - verify mobile/RTL layouts have no horizontal overflow.
- Full regression: cashier settlement, budgets, fixed expenses, salary, installments, loans, pending payments, export, unit tests, database suites, Playwright, lint, typecheck, and production build.

## Builder-owned implementation details

- Exact component split for wallet cards, balance management, reorder mode, and guided deletion.
- Exact SQL helper names and dependency-safe order inside the one forward migration.
- Whether historical wallet-name snapshots live on every monetary row or in an immutable history relation, provided deleted-wallet Activity and exports remain durable.
- Accessible drag library reuse versus the native controls already used by category ordering.
