# Custom currencies design

## Intent

Let each signed-in user add and manage the currencies they actually use instead of being limited to the built-in USD, LBP, and SYP set. A currency is defined by its code, display symbol, and number of decimal places. Currency configuration must remain tenant-safe and must never reinterpret money that has already been recorded.

## Goals

- Add a **Currencies** destination under Settings with a list of enabled and disabled currencies.
- Let a user create a currency with:
  - an uppercase code;
  - a display symbol;
  - decimal precision from 0 through 8.
- Make enabled currencies available everywhere the app currently uses the hardcoded `USD | LBP | SYP` list: wallets, activity, transfers, cashier payments and change, budgets, fixed expenses, installments, salary, loans, pending payments, totals, filters, and export.
- Let a user disable a currency even after it has history. Disabled currencies remain visible on historical and existing records but are absent from controls that create new monetary records.
- Let a user re-enable a disabled currency.
- Preserve the current values and behavior of existing USD, LBP, and SYP records during migration.
- Preserve exact integer-minor-unit arithmetic for up to eight decimal places.

## Non-goals

- No exchange-rate service, live rates, automatic conversion, or general custom-currency rate configuration.
- No conversion or rescaling of existing ledger amounts when this feature is deployed.
- No sharing of a user's custom currency definitions with another user.
- No localized currency names or currency-specific rounding modes in this version.
- No deletion of a currency that has ever been referenced by monetary data.

## Anti-goals

- Do not store currency definitions only in profile JSON or rely only on client validation.
- Do not silently fall back to USD when a stored currency definition is missing or malformed.
- Do not allow changing decimal precision after use, because that would reinterpret stored integer amounts.
- Do not hide historical rows, wallets, totals, or exports merely because their currency is disabled.
- Do not combine totals from different currency codes.

## Constraints and validation

- Currency definitions are owned by one `user_id`; codes are unique per user.
- Codes are trimmed, uppercased by the UI, and accepted only when they match `^[A-Z][A-Z0-9]{0,11}$` (1-12 ASCII characters). The server and database repeat this validation.
- Symbols are trimmed, non-empty Unicode text with a database `char_length` limit of 12. Symbols are display text only and never participate in identity or arithmetic.
- Decimal places are integers from 0 through 8.
- New definitions start enabled.
- At least one currency must remain enabled for each user.
- Code and decimal places may be edited only while the definition has no monetary references. Once used anywhere, both are permanently locked. The symbol remains editable.
- An unused definition may be deleted. A referenced definition may only be disabled.
- Disabling affects future creation, not reading. Server actions and database functions reject forged attempts to create new monetary data in a disabled currency, while edits that preserve the currency of an existing record remain possible.
- Existing amount bounds remain `MAX_MINOR = 1_000_000_000_000_000`. With eight decimals this intentionally permits a smaller maximum major-unit value; the UI must explain an out-of-range amount through the existing validation treatment.

## Approaches considered

### Selected: per-user relational currency table

Create a normalized `currencies` table keyed by `(user_id, code)`, migrate enum-backed currency values to text-backed references, and enforce ownership and enabled-state rules in the database. This is the only approach that provides genuinely user-specific definitions while retaining relational integrity and safe historical references.

### Rejected: global catalog plus per-user enablement

A global catalog is convenient for ISO fiat currencies, but custom codes, symbols, and precision can conflict between users. It works against the requirement that a user may define any currency.

### Rejected: profile JSON plus plain currency text

JSON would reduce migration work, but it weakens reference integrity, makes concurrency rules difficult, and risks orphaned or cross-tenant currency values. The app already relies heavily on database-enforced monetary invariants, so this tradeoff is not acceptable.

## Data model and migration

Add `public.currencies` with:

- `user_id uuid not null references auth.users(id) on delete cascade`
- `code text not null`
- `symbol text not null`
- `decimal_places smallint not null`
- `first_used_at timestamptz`
- `disabled_at timestamptz`
- `created_at timestamptz not null default now()`
- primary key `(user_id, code)`
- checks for code, symbol, and precision constraints
- RLS policies restricting reads and mutations to `auth.uid()`

The authentication bootstrap creates enabled defaults for every new user:

| Code | Symbol | Decimal places |
| --- | --- | ---: |
| USD | $ | 2 |
| LBP | LBP | 0 |
| SYP | SYP | 0 |

The migration creates those same three definitions for every existing user before converting references. It then converts all `public.currency` columns and relevant function parameters/return columns to validated text without changing any amount. This includes wallets, transactions and transfer metadata, budgets, installments, loans, pending payments, cashier-change rows, cross-currency cost fields, and all stored functions/views that expose currency.

Tables that already carry `user_id` should use a composite foreign key to `(user_id, currency)` where practical. Derived rows and structures that obtain ownership through a parent must validate the currency under the same row locks used by their integrity trigger. RPCs must resolve a caller-owned definition explicitly; another user's code is treated as unavailable.

Database functions that currently cast JSON input to `public.currency` must parse bounded text and look up the caller's definition instead. Return types become `text`. After all dependencies have moved, drop the enum type.

Currency definition mutation must be concurrency-safe:

- Creating the first monetary reference locks the selected currency definition, confirms it is enabled, and sets `first_used_at` in the same transaction. This durable marker is never cleared, even if every referencing row is later hard-deleted, so "once used" remains permanent.
- Editing code or precision, deleting, or disabling a definition takes a conflicting row lock and rechecks references/state.
- The reference check covers active, archived, soft-deleted, scheduled, template, and snapshot data. A concurrent first use cannot race with deletion or a precision/code edit.
- Disabling is allowed with references but must serialize with new-record creation, so either the new record commits first or creation observes the disabled state and fails.

The existing USD/LBP remembered reference rate remains a special legacy feature. It is offered only when the two codes are USD and LBP and both definitions are enabled. Other custom currencies continue to use explicit sent/received amounts with no inferred rate.

## Application model

Replace the compile-time union and global maps with a runtime `CurrencyDefinition` model containing `code`, `symbol`, `decimalPlaces`, and `disabled`. Currency identity in feature schemas becomes a validated code string; places that format or parse amounts must also receive the matching definition or a request-scoped definition lookup.

Load the user's complete currency catalog with the existing app-shell data. The provider exposes:

- all definitions for historical rendering;
- enabled definitions for creation controls;
- `currencyByCode(code)` for strict lookup.

Missing definitions are treated as data-load errors, not as USD. Demo/unconfigured mode uses the three default definitions.

Refactor money helpers so parsing, formatting, editable text, and input mode use `decimalPlaces` from a definition. Arithmetic remains integer/`BigInt` based. Parsing accepts no more than the configured decimal count; formatting renders exactly that count using the configured symbol; input conversion may trim insignificant trailing fractional zeroes as it does today. Accumulators become maps keyed by runtime codes rather than fixed `Record<Currency, number>` objects.

Server-side queries validate returned currency codes against the request's loaded catalog. Mutations validate both ownership and enabled state independently of client input. Export includes the stored code and renders amounts using the matching definition.

## Settings experience

Settings gains a **Currencies** link alongside Categories. `/[locale]/settings/currencies` uses the existing screen header, page body width, sheets, buttons, and bilingual message structure.

The page lists enabled currencies first and disabled currencies second. Each row shows the symbol, code, decimal-place summary, and disabled status where applicable. An **Add currency** button opens a sheet with code, symbol, and decimal-place fields. Decimal places use a bounded numeric control suitable for 0-8, and the form previews a representative formatted amount.

Selecting a row opens its settings sheet:

- Unused: code, symbol, and decimal places are editable; deletion is available behind confirmation.
- Used: code and decimal places are read-only with a concise explanation; symbol remains editable.
- Enabled: a Disable action is available unless this is the user's last enabled currency.
- Disabled: an Enable action is available.

After a successful mutation, revalidate the app layout so selection controls and formatting use the new catalog immediately. Failures use localized inline alerts and do not close the sheet.

All English copy receives an Arabic equivalent. Codes and example amounts are isolated with `bdi dir="ltr"`; layout and sheets must retain the project's no-horizontal-overflow behavior in both locales.

## Behavior throughout the product

- Creation selectors show enabled definitions only and preserve the catalog order (created defaults first, then user-created currencies by creation time/code).
- Existing wallets and records keep rendering with disabled definitions.
- A disabled currency's existing wallets are visible but cannot be selected for new transactions, transfers, salary/fixed/installment/loan payments, receipts, or cashier change.
- Existing fixed-expense, installment, salary, loan, and pending-payment definitions in a disabled currency remain intact but cannot create or receive a new payment until the currency is re-enabled. The UI presents those actions as unavailable rather than silently changing or deleting the template.
- Filters and summary sections include disabled currencies whenever the current result set contains them.
- Budget query-string validation accepts only enabled currencies for creating/viewing an empty current selection, but historical result links with a disabled currency remain renderable through explicit stored data paths.
- Cross-currency transfers remain explicit: users enter the actual sent and received amounts. Same-currency transfer equality is based on matching code, independent of the display symbol.
- Changing a symbol affects all rendering, including history and exports, because the symbol is presentation metadata; stored codes and amounts do not change.

## Error handling

Expose stable action errors for invalid definition, duplicate code, last-enabled currency, currency in use, disabled currency, and generic persistence failure. User-facing messages are localized and avoid leaking whether another user owns a colliding or referenced record.

If app data contains a code with no matching definition, fail the affected query/view visibly using the existing unavailable-state patterns. Never guess precision or symbol.

## Testing and verification

Use test-first implementation for each behavior.

- Unit tests: definition schemas; 0, 2, 3, and 8 decimal parsing/formatting; Unicode symbols; runtime accumulators; missing-definition failures; enabled filtering.
- Component tests: add/edit form validation and preview; locked fields after use; enable/disable/delete actions; dynamic currency choices; disabled historical rendering.
- Server action/query tests: authentication, tenant isolation, duplicate codes, state-specific errors, and catalog loading.
- Database pgTAP tests: bootstrap defaults, migration preservation, constraints/RLS, cross-tenant rejection, reference locking, disabled-state enforcement, last-enabled protection, and complete reference coverage.
- Two-connection database tests: first-use versus edit/delete, new monetary record versus disable, and re-enable/create serialization.
- End-to-end tests in English and Arabic: create an eight-decimal currency, create and use a wallet with it, verify formatted history, disable it, confirm it disappears from new-entry controls while history remains, then re-enable it.
- Regression suite: current USD/LBP/SYP behaviors, USD/LBP rate memo, cashier settlements, transfers, budgets, salary, installments, loans, pending payments, exports, typecheck, lint, unit tests, database tests, and Playwright coverage.

## Builder-owned implementation details

- Choose the exact component split and query batching while preserving the data-loading and error semantics above.
- Choose whether the settings list uses a dedicated query or the app provider's catalog, provided server rendering and post-mutation revalidation stay consistent.
- Stage the PostgreSQL dependency replacement in the safest order inside a new forward-only migration; do not rewrite historical migration files.
- Update generated Supabase types after the migration.
