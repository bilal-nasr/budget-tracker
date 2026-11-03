# 06 · Exchange rate when moving between currencies

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. No commit steps (owner commits).

**Goal:** Moving money between a USD and an LBP wallet asks for the rate as `1 $ = [ ] LBP`, fills in the converted amount, and lets the owner edit that amount before saving.

**Owner note:** "When moving from wallet to wallet with different currencies let me input the USD→LBP exchange rate like 1$ = {my input number} and it will be converted (I can edit the conversion too before adding the number)."

**Architecture:**
- Today the Move tab in `src/components/add/transaction-sheet.tsx` shows a bare "Received (LBP)" field when the currencies differ. It becomes: a **Rate** row (`1 $ =` [input] `LBP`), then the **Received** field pre-filled from `amount × rate`. Editing Received stops it following the rate and shows a "Use rate" button to go back.
- The rate is always written as LBP per 1 USD, whichever direction the money goes.
- Conversion lives in `src/lib/money.ts` (the only place money math is allowed), with BigInt so large LBP amounts never lose precision.
- The last rate used is saved on the profile (`profiles.usd_lbp_rate`) and pre-fills the next exchange on any device. It is also the "reference rate" that Phase 5 planned for ≈ hints, so Phase 5 does not need its own column.
- The transaction itself still stores only what left and what arrived (`amount_minor`, `to_amount_minor`). The rate is derivable and is not stored per row.

**Tech stack:** existing transfer action and schema, Postgres migration, Vitest.

## Global constraints

All of [README § Global constraints](README.md#global-constraints-every-plan-every-task).

## Review focus

- LBP → USD conversions that round to $0.00 (e.g. LBP 100 at 89,500): Received becomes 0 and Save stays disabled with "Amount too small to convert".
- Arabic digits typed into the rate field (`٨٩٥٠٠`) parse the same as Latin.
- Rate with thousands separators (`89,500`) parses; decimals in the rate (`89500.5`) are rejected with a clear message.
- Changing the source wallet, destination wallet or amount after editing Received: Received keeps the owner's edit until "Use rate" is pressed (no silent overwrite).
- Same-currency move: no rate row at all (unchanged behaviour).

---

### Task 1: Conversion and rate parsing in `money.ts`

**Files:**
- Modify: `src/lib/money.ts`, `src/lib/money.test.ts`

**Interfaces:**
- Produces:

```ts
export const MAX_RATE = 10_000_000; // LBP per USD
/** "89,500" / "٨٩٥٠٠" → 89500. Whole numbers 1..MAX_RATE only, else null. */
export function parseRate(input: string): number | null;
/** Converts with a USD→LBP rate. USD→LBP: round(cents × rate / 100). LBP→USD: round(lira × 100 / rate). Half away from zero. Null if the result exceeds MAX_MINOR. Same currency returns minor unchanged. */
export function convertAtRate(minor: number, from: Currency, to: Currency, lbpPerUsd: number): number | null;
```

- [ ] **Step 1: Write the failing tests** in `src/lib/money.test.ts`:

```ts
expect(parseRate("89500")).toBe(89500);
expect(parseRate("89,500")).toBe(89500);
expect(parseRate("٨٩٥٠٠")).toBe(89500);
expect(parseRate("0")).toBeNull();
expect(parseRate("89500.5")).toBeNull();
expect(parseRate("10000001")).toBeNull();

expect(convertAtRate(10000, "USD", "LBP", 89500)).toBe(8_950_000);   // $100.00
expect(convertAtRate(895_000, "LBP", "USD", 89500)).toBe(1000);      // $10.00
expect(convertAtRate(1_000_000, "LBP", "USD", 89500)).toBe(1117);    // 11.173… → $11.17
expect(convertAtRate(100, "LBP", "USD", 89500)).toBe(0);
expect(convertAtRate(MAX_MINOR, "USD", "LBP", 89500)).toBeNull();
expect(convertAtRate(5000, "USD", "USD", 89500)).toBe(5000);
```

- [ ] **Step 2:** `pnpm test src/lib/money.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement with `BigInt` and integer rounding (no floats).
- [ ] **Step 4:** Re-run. Expected: PASS.

### Task 2: Save the rate on the profile

**Files:**
- Create: `supabase/migrations/20261110000000_profile_rate.sql`
- Modify: `src/features/profile/schema.ts`, `src/features/profile/queries.ts`, `src/features/transactions/schema.ts`, `src/features/transactions/actions.ts`, `src/components/providers/app-data.tsx`, `src/app/[locale]/(app)/layout.tsx`, `src/lib/demo-data.ts`
- Regenerate: `src/lib/supabase/database.types.ts` (`pnpm db:types`)

**Interfaces:**
- Migration: `alter table public.profiles add column usd_lbp_rate integer check (usd_lbp_rate is null or usd_lbp_rate between 1 and 10000000);`
- `Profile` gains `usdLbpRate: number | null`; `AppData` gains `usdLbpRate: number | null`; demo value `89500` (`DEMO_RATE`).
- `transferInputSchema` gains `rate: z.number().int().min(1).max(MAX_RATE).optional()`. `createTransfer` saves it to `profiles.usd_lbp_rate` after the transfer insert succeeds, only when the two wallets' currencies differ. A failed rate save does not fail the transfer.
- `getProfile` keeps its fallback select for databases where the column does not exist yet (same pattern as the salary columns).

- [ ] **Step 1:** Write the migration. Apply locally with `pnpm db:reset` (or to the hosted project via the dashboard SQL editor, as previous migrations were), then `pnpm db:types`.
- [ ] **Step 2:** Thread `usdLbpRate` through profile → layout → `AppDataProvider`.
- [ ] **Step 3:** Extend the schema and action. `pnpm typecheck && pnpm test`. Expected: PASS.

### Task 3: Rate row in the Move tab

**Files:**
- Modify: `src/components/add/transaction-sheet.tsx`, `src/messages/en.json`, `src/messages/ar.json`
- Test: `e2e/move.spec.ts`

**Strings (`Add` namespace):** `rate` "Exchange rate" / "سعر الصرف"; `rateUsd` "1 $ =" (both languages, LTR); `rateLbp` "LBP" / "ل.ل"; `rateHelp` "Use the rate you actually got." / "استخدم السعر الذي حصلت عليه فعلاً."; `useRate` "Use rate" / "استخدم السعر"; `errorRate` "Enter a whole number, e.g. 89500." / "أدخل رقماً صحيحاً، مثلاً 89500."; `errorTooSmall` "Amount too small to convert." / "المبلغ صغير جداً للتحويل.". `receivedHelp` is replaced by `rateHelp`.

State: `rateText` (initial `usdLbpRate ? String(usdLbpRate) : ""`), `receivedText`, `receivedEdited: boolean`. While `!receivedEdited`, `receivedText` is derived: `toInputText(convertAtRate(minor, currency, toWallet.currency, rate), toWallet.currency)`. Typing in Received sets `receivedEdited = true`; "Use rate" sets it back to false. Save sends `rate` along with the two amounts.

Layout: the rate row is one line, `dir="ltr"` (it is a formula): `1 $ =` · input (inputMode `numeric`, 16px, `aria-label={t("rate")}`) · `LBP`. Received field under it, labelled `received` as today.

- [ ] **Step 1: Write the failing tests** in `e2e/move.spec.ts` (demo rate 89,500, demo wallets Cash USD and Cash LBP):

```ts
test("exchange asks for 1$ = rate and converts, and the result can be edited", async ({ page }) => {
  await openMove(page);                     // existing helper or: open Add → Move
  await pickFrom(page, "Cash · USD");
  await pickTo(page, "Cash · LBP");
  await typeOnKeypad(page, "100");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Exchange rate")).toHaveValue("89500");
  await expect(dialog.getByLabel(/Received/)).toHaveValue("8950000");
  await dialog.getByLabel("Exchange rate").fill("90000");
  await expect(dialog.getByLabel(/Received/)).toHaveValue("9000000");
  await dialog.getByLabel(/Received/).fill("8900000");
  await dialog.getByLabel("Exchange rate").fill("91000");
  await expect(dialog.getByLabel(/Received/)).toHaveValue("8900000");  // edit kept
  await dialog.getByRole("button", { name: "Use rate" }).click();
  await expect(dialog.getByLabel(/Received/)).toHaveValue("9100000");
});

test("same-currency move shows no rate", async ({ page }) => { /* Bank USD → Cash USD: Exchange rate field count 0 */ });
test("LBP to USD too small to convert keeps Save disabled", async ({ page }) => { /* LBP 100 → error text, Save disabled */ });
```

Arabic: `/ar`, the rate row reads `1 $ = 89500 ل.ل` left-to-right, no overflow at 320px.

- [ ] **Step 2:** `pnpm test:e2e e2e/move.spec.ts`. Expected: new tests FAIL.
- [ ] **Step 3:** Implement the row and state.
- [ ] **Step 4:** Re-run the suite. Expected: PASS. Screenshots at 390px EN/AR.
- [ ] **Step 5:** Live: make a USD → LBP move at a new rate; open a new Move and check the rate is pre-filled; check both wallet balances.

## Decisions made for the owner

- Rate is a whole number of LBP per dollar (how it is quoted in Lebanon). Decimal rates are rejected.
- The rate is not stored on each transaction: what left and what arrived are the facts, and the rate is their ratio.
