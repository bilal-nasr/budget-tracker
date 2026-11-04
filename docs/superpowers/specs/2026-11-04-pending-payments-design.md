# Pending freelance payments

Track work already owed to the user and receive it in multiple parts. The user selected a separate Pending payments section and confirmed partial payments, then asked to proceed.

## Approach

Use a dedicated pending-payment record and link ordinary income transactions to it. Reusing Loans would misclassify earned income as principal; treating future income as a wallet transaction would inflate available cash. Pending balances never affect wallets, budgets, salary cycles, or reports. Actual receipts are ordinary income and use the existing ledger and revision-based delete/Undo flow.

## Behavior

Reach the section from Wallets. Add a client, project, amount, currency, and optional due date. List outstanding and completed jobs with total, received, and remaining amounts; separate currency totals. Record each receipt with amount, date, receiving wallet, and income category. Show receipt history. Edit job details and total, provided total stays at least the amount received. Delete jobs only before any receipt history exists.

## Integrity and constraints

Use integer minor units in USD, LBP, SYP, matching-currency active wallets, owned income categories, validated dates, RLS, and atomic database writes. Serialize receipts per job to reject overpayments. Stable request IDs make uncertain retries safe. Ledger edits, deletion, and restoration must preserve ownership, currency, and the total cap. English/Arabic, RTL, existing shared sheets and design tokens. No new dependencies, commits, deployment, or remote database mutation.

## UI direction

Extend the incumbent Encaustic Floor Operate surface: teal header, limestone ground, compact white bordered rows, Readex typography, logical spacing, amounts isolated. The first viewport leads with Pending payments, a brief balance explanation, per-currency outstanding totals and Add payment. Rows disclose received and remaining amounts; receipt entry uses the shared bottom sheet. Keep the existing navigation structure.
