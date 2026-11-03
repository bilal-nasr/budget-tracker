# Owner feedback round 2: implementation plans

Plans for the ten notes the owner sent on 2026-11-03. One file per feature; the order below is the build order.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to work a plan task by task. Steps use checkboxes (`- [ ]`). **No commit steps.** The owner commits by hand (global rule); stop after typecheck, lint and tests pass.

| # | Plan | Owner note | Depends on |
| --- | --- | --- | --- |
| 01 | [Speed: taps, actions, navigation](01-performance.md) | "every click is taking a while to render" | none |
| 02 | [Language switch speed and theme loss](02-language-and-theme.md) | "toggle is slow and the theme switches to light" | 01 (same action pattern) |
| 03 | [Confirm before Got salary](03-salary-confirm.md) | "Got salary button needs a confirmation popup" | none |
| 04 | [Add sheet: Name field and category dropdown](04-add-sheet-name-and-category.md) | "include the name input" + "categories as a dropdown" | none |
| 05 | [Fixed expense totals per wallet, salary after fixed](05-fixed-totals.md) | "what to put in each wallet … salary after all are paid" | none |
| 06 | [Exchange rate when moving between currencies](06-exchange-rate-move.md) | "let me input 1$ = {number}" | none |
| 07 | [Installments](07-installments.md) | "add installment to fixed expenses …" | 04 (CategorySelect), 05 (summary) |
| 08 | [Budgets section](08-budgets.md) | "implement the budget section" | 05 (salary-after line in the edit sheet); 07 sets up pgTAP first if it runs earlier |
| 09 | [Open sign-up with email verification](09-signup.md) | "allow signup new accounts" | none (product decision, see plan) |

01 to 04 are small and independent; they can run in parallel worktrees. 05 to 08 touch the Home cards and the Fixed sheet, so run them one after another.

## Global constraints (every plan, every task)

Copied from `CLAUDE.md`; these are acceptance criteria for every task below.

- Phone first: build at 390px; base Tailwind classes are the phone, `sm/md/lg` add. Touch targets ≥ 44px, inputs ≥ 16px font, `min-h-dvh`, fixed bars respect `env(safe-area-inset-*)`.
- Modals are bottom sheets on phones: use `SheetShell` (`src/components/ui/sheet-shell.tsx`).
- Logical utilities only (`ms-`, `pe-`, `start-`, `text-start`). Lint fails on physical ones.
- Every new string goes into both `src/messages/en.json` and `src/messages/ar.json` in the same change (`src/messages/messages.test.ts` checks key parity).
- Names and amounts in `<bdi>`; amounts never mirror. Money is integer minor units (USD cents, LBP whole lira), parsed and formatted only through `src/lib/money.ts`. Never add or compare USD with LBP.
- Schema changes only as new files in `supabase/migrations/`, named after `20261109000100_transfers.sql` (next free: `20261110000000_…`). RLS on every new table: `user_id = (select auth.uid())`. Regenerate types with `pnpm db:types` afterwards.
- Reads in Server Components, writes in Server Actions validated with zod, returning `ActionResult` from `src/lib/supabase/action.ts`.
- After a write, the Server Action calls `revalidatePath("/", "layout")` and the client **does not** call `router.refresh()` (plan 01 removes the existing calls; new code must not add them back).
- Demo mode (no Supabase env) must keep working: add synthetic rows to `src/lib/demo-data.ts` for any new data, and writes return `notConfigured`.
- `/impeccable` before any UI task (global rule). A new screen gets a 390px mockup for the owner before the full build.
- Done means `docs/MOBILE-UX.md` §14: screenshots at 390px in EN and AR, no horizontal overflow (`expectNoHorizontalOverflow` in `e2e/support.ts`).

## Verification commands (used by every plan)

```bash
pnpm typecheck
```

```bash
pnpm lint
```

```bash
pnpm test
```

```bash
pnpm test:e2e
```

Run a single e2e file with `pnpm test:e2e e2e/<file>.spec.ts`. E2E runs against demo data.

## Open questions for the owner

Each plan ends with the decisions it made on the owner's behalf. The ones worth a look before building:

1. **04**: Name is optional (rows fall back to the category name) so logging stays under 10 seconds. Make it required?
2. **06**: The rate is saved to your profile and pre-filled next time. It also becomes the "reference rate" Phase 5 planned for ≈ hints.
3. **07**: A payment can come from another wallet only if it has the same currency as the installment. Paying a USD installment from an LBP wallet would need the exchange flow from 06; left out for now.
4. **09**: Opening sign-ups changes the product from one owner to many accounts. Hosted Supabase's built-in mailer only sends to your own team's addresses, so verification emails need a custom SMTP provider (for example Resend) before anyone else can sign up.
