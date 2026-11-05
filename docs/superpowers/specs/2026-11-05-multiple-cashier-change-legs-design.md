# Multiple Cashier Change Legs

## Intent

When recording an expense, keep the purchase cost separate from the cash handed to the cashier and allow the returned change to contain multiple actual cash amounts. The motivating example is paying USD 20 and receiving USD 5 plus an LBP remainder. No exchange rate is calculated or required.

## Goals

- Keep the expense amount as the separately entered purchase cost used by spending and budget reports.
- Debit the paying wallet by the full tender amount.
- Credit every returned amount to an active wallet with the same currency as that amount.
- Save, edit, duplicate, delete, restore, replay, and display the expense and all change legs atomically.
- Preserve existing expenses that contain one saved change amount.
- Keep English and Arabic form behavior and validation aligned.

## Non-goals and anti-goals

- Do not infer the purchase cost from the cash movements.
- Do not calculate, request, or update an exchange rate for new multi-currency change.
- Do not create separate visible income or transfer transactions for returned change.
- Do not permit a partially saved settlement or a change amount without a matching active wallet.
- Do not redesign ordinary expenses, itemized expense breakdowns, or wallet-to-wallet moves.

## Selected approach

Use a normalized collection of cashier change legs owned by one expense. Each leg stores its receiving wallet and actual amount; its currency is derived from and validated against that wallet. The expense retains one tender amount in the paying wallet's currency. Existing single-change columns are migrated into one child leg and the application reads the collection as the canonical settlement shape.

The add/edit form replaces the single change editor with a repeatable list. The first row preserves today's simple flow, “Add another change” creates another row, and each row selects a currency, amount, and matching wallet. A row can be removed. Saving is enabled only when the tender and every visible row are complete and valid. For same-currency-only change, tender minus the total returned amount must equal the separately entered cost. When any returned leg uses another currency, the app records all actual amounts without conversion and only requires the tender to exceed the purchase cost.

Wallet balances debit the tender once and credit every active change leg once. Activity details summarize all returned amounts. Editing and duplication populate every leg. Historical archived receiving wallets remain readable for unchanged edits, while new or financially changed settlements require active receiving wallets.

## Alternatives considered

- **Two fixed change fields:** smaller initial UI change, but duplicates columns and validation, arbitrarily caps the real cash event at two returned amounts, and complicates future maintenance.
- **Separate linked transactions:** reuses ledger rows, but exposes implementation entries as income/transfers, risks double-counting, and makes atomic editing, replay, and deletion harder to reason about.

The normalized child collection was selected because it represents the event directly, supports the requested example without an arbitrary limit, and preserves one expense for reporting.

## Constraints and verification

- Follow the installed Next.js 16.4.5 documentation before changing framework-facing code.
- Introduce the behavior test-first at the TypeScript, component, database, and end-to-end boundaries.
- Add an append-only Supabase migration, update generated/manual database types as needed, and retain row-level ownership and deterministic wallet locking.
- Verify legacy single-change migration, USD 20 tender with USD 5 plus LBP change, wallet balance effects, edits, duplicate/replay behavior, archived-wallet rules, deletion/restore, bilingual UI, and the full test/typecheck/lint/build suites available locally.
