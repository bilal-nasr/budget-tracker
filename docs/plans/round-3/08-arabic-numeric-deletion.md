# Arabic Numeric Entry and Deletion Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` within the orchestrator's assigned checkout and file ownership. The owner subsequently authorized implementation and a final combined commit/push; the parent alone owns that final git operation. This session must not stage, commit, push, create worktrees/chats, or run an app server. The bounded implementation lease and actual evidence are recorded below.

**Goal:** Fix the owner's cross-field native-number-keyboard deletion failure on iPhone in Arabic while preserving exact monetary values and native text selection.

**Architecture:** Investigate shared actual-input direction, iOS touch caret placement, first-focus selection and Drawer interaction across native numeric fields before choosing the smallest shared correction. Preserve the browser's raw editable string synchronously and derive validation separately. The due-day Arabic-digit filtering defect is a separate, secondary correction; it cannot explain the owner's cross-field report.

**Tech stack:** Installed Next.js 16.4.5 App Router, React 19.3, TypeScript, next-intl, existing Tailwind/Base UI components, Vitest, Playwright.

**Spec:** Proposed design/spec in this document, owner item 8, `PRODUCT.md`, `docs/MOBILE-UX.md` §§5,7,9,10,14, `docs/ARCHITECTURE.md` §§6,7,9, `DESIGN.md`, `.impeccable/surfaces/src-app-locale.md`. Recommendations here are proposals, not owner-approved product decisions.

## Global constraints

- Phone first at 390 × 844; verify 320, 390, 430, 768 and 1280px and landscape phone. Preserve existing layout, tokens, 44px touch targets, inputs at least 16px, safe areas and sheets.
- English and Arabic parity; logical RTL utilities only. Labels and surrounding layout follow the locale; numeric editing can remain LTR. Display amounts continue through `Amount`/`<bdi dir="ltr">` and retain the profile's digit preference.
- USD cents and LBP whole lira remain integer minor units. Parse/format money only through `src/lib/money.ts`; preserve `MAX_MINOR`, currency precision and exact conversion math. Never infer or combine currencies.
- Keep Server Actions, zod validation, `ActionResult`, tenant isolation and unconfigured demo behavior. No dependency or configuration changes are proposed.
- No schema change is needed. Any separately discovered schema requirement belongs to the orchestrator, with append-only migration numbering coordinated there; do not reserve a migration number for this item.
- This scope is numeric-entry correctness, not keypad replacement, a number-format preference redesign, or a broad form redesign. Read the impeccable skill before any eventual UI implementation per `CLAUDE.md`.

## Review focus

1. On iPhone, a prefilled Arabic-page input must delete at the touch-placed caret from first focus, including without programmatically positioning the caret. Select-all must remain an option, never a prerequisite. Task 1 captures the failure; Task 2 pins behavior.
2. Arabic/Latin digits, mixed scripts, selection replacement and paste must not disappear or relocate the caret because application code rewrites the value. Tasks 2–3 cover both parser and DOM behavior.
3. Empty, `0`, `0.`, `12.` and Arabic decimal intermediates must remain editable; parsing must not repopulate a deleted value or silently convert partial/invalid text to saved money. Task 2 covers this and field-specific empty semantics.
4. Derived exchange Received values must stop following the rate on the first manual edit, including clearing the field; a later rate change must not refill a cleared manual value. Task 2 covers this.
5. Native Android/iOS keyboard, composition, long-press selection and repeated delete must work in the actual sheet. Desktop browser emulation is supporting evidence only. Task 4 is required real-device verification.

## Investigation and current evidence

### Owner-confirmed reproduction scope (updated 2026-11-04)

The owner reports **iPhone** and **all inputs when clearing a number with the native number keyboard**: Backspace does not clear the number until the whole value is selected and deleted. This is a cross-field problem, not a report confined to due-day entry. The surrounding task concerns Arabic locale, and the owner suspects cursor alignment. Treat that suspicion as a hypothesis until touch/caret evidence confirms it.

Browser (Safari, installed PWA or another browser), iOS version and keyboard variant remain unknown. No further owner question is requested in this planning session. Use available native iPhone validation to investigate shared actual-input direction, first-focus behavior, touch placement and selection offsets, comparing Drawer fields with onboarding's outside-Drawer form. Confirmation of the device/scope comes from the owner; technical reproduction and root-cause confirmation have not yet occurred.

### What was actually done

Read-only repository inspection, recent commit/diff inspection, installed framework guides, and official browser/React documentation. No product code, dependencies or configuration were changed; no product tests, build, typecheck, lint, migration, browser session or server was run. No phone keyboard was exercised, so **the owner's exact deletion symptom has not been reproduced**. Do not describe this plan as a confirmed fix for that symptom.

Installed guides read before version-sensitive recommendations:

- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`: state, event handlers and browser APIs remain in the existing Client Component islands.
- `node_modules/next/dist/docs/01-app/02-guides/forms.md`: retain server-side authentication/authorization and zod validation; this input fix changes neither action signatures nor write paths.
- `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md` and `testing/playwright.md`: unit-test pure parsing and use browser tests for application behavior. Existing `vitest.config.mts` uses the Node environment; do not assume a DOM component test already runs there.

Recent history inspected: `ff1dbce` added installments, budgets and the exchange rate flow; the latest three commits include that feedback round and two auth-only changes. No inspected change proves an Arabic-specific deletion regression. Read current code rather than relying on older plan descriptions: Settings has no rate input, and primary Add amount entry is currently keypad-only on every viewport.

### Inventory of numeric entry surfaces

All current native numeric-entry controls are text inputs (implicit default type); none uses `type="number"`. Search covered `src`, including onboarding and the developer kitchen sink. Auth email/date controls are not numeric money-entry controls.

| Current file / interface | Fields and value behavior | Direction / keyboard / concern |
| --- | --- | --- |
| `src/components/ui/text-field.tsx`, `TextField({ label, error, className, ...props })` | Shared label + native input; forwards `value`, `onChange`, ref and input props without parsing. `className` styles the outer wrapper. | No own direction or numeric policy. Input height 48px, text 16px. Do not try to change input alignment by passing its existing wrapper `className`. |
| `src/components/wallets/wallet-sheet.tsx`, exported `WalletForm` | Opening amount and optional cross-currency `takenText`; both synchronously store `e.target.value`. Empty opening amount means zero; empty required taken amount blocks funding. Onboarding reuses this form. | Explicit `dir="ltr"`, decimal for USD / numeric for LBP, autocomplete off. Currency change strips the substring after Latin `.` only. |
| `src/components/salary/salary-sheet.tsx`, private `Form` | Salary amount, raw string; initial `toInputText`. Required positive amount; empty disables Save. | Explicit LTR, currency keyboard. Wallet-to-LBP switch strips Latin fraction. |
| `src/components/fixed/fixed-sheet.tsx`, private `Form` | Amount raw string. **Due day transforms every change with `replace(/\D/g, "").slice(0, 2)`**, then uses `Number(dueDay)`. | Both explicit LTR. Due day numeric keyboard. Arabic digits are removed by the ASCII-only filter; input rewrite is a concrete editing defect. |
| `src/components/installments/installment-sheet.tsx`, exported `InstallmentForm` | Total, paid-before and monthly amount raw strings. **Due day has the same ASCII-only change filter** and `Number` conversion. | Explicit LTR, currency keyboard for money, numeric for due day. Optional paid-before empty means zero; optional monthly/due day empty means null. |
| `src/components/installments/installment-pay-sheet.tsx`, private `Form` | Payment amount raw string, prefilled `toInputText`; derived remaining label; overpayment blocks Save. | Explicit LTR and currency keyboard. No value formatting in the handler. |
| `src/components/budget/budgets-sheet.tsx`, private `Form` | One raw text input per category, stable category key; derives total separately; empty means no limit, distinct from zero. | Explicit LTR, currency keyboard, `text-end` on the input itself. Right-side alignment of an LTR input alone is not evidence of a deletion bug. |
| `src/components/add/transaction-sheet.tsx`, private `Form` | Exchange `rateText` raw. Received is derived until first `onChange`, which stores raw text and sets `receivedEdited=true`. | Rate inherits LTR from formula wrapper; Received explicit LTR. Both numeric/decimal as applicable. Test the first delete from a derived Received value. |
| Same Add form + `src/components/add/amount-keypad.tsx` | Primary amount is a paragraph with currency span and `groupTyped(typed)` display, **not an input**. `AmountKeypad` emits entire strings through `onChange(next: string)`. | Keypad `dir="ltr"`; `applyKey(value,key,currency)` appends keys, supports USD dot / LBP `000`, backspace is `slice(0,-1)`. Native keyboard caret/selection/paste do not apply to that display. |

Other relevant boundaries:

- `src/lib/money.ts`: private `normalizeDigits` maps `٠–٩`, maps `٫` to `.`, removes grouping commas/`٬` and whitespace; `parseAmount(input,currency)` and `parseRate(input)` return numbers or null. `toInputText` initializes editable strings, `formatAmount` formats display, and `groupTyped` is used only for the non-editable Add amount. No live grouping formatter feeds a native amount input's value.
- `parseAmount` rejects trailing decimal separators and does not accept Eastern Arabic/Persian digits `۰–۹`; `parseTyped` in Add alone tolerates a trailing Latin dot for the keypad. Native controls retain partial strings but may show validation errors until complete. This is validation behavior, not proof deletion is prevented.
- Every native money handler found stores the DOM string synchronously. There are no app-level `onKeyDown`, `beforeinput`, selection restoration or numeric preventDefault handlers. Ordinary typing does not change the inspected form keys. Existing code therefore does **not** support a blanket claim that parsing or formatting restores every deleted digit.
- `src/app/globals.css` `.amount` already sets LTR, bidi isolation and no-wrap; shared native input styling does not set direction or text alignment. `src/components/ui/drawer.tsx` has `select-none` on viewport/popup; inspect computed input selection behavior on the failing device before attributing anything to it. The shared text fields occur inside `SheetShell`, whereas onboarding's `WalletForm` also provides a useful outside-Drawer comparison.
- Display digit preference is supplied by `src/components/providers/display-prefs.tsx`; most editable values initialize to Latin via `toInputText`. App locale, digit display preference, OS language, and active keyboard language are four separate matrix axes.

### Root-cause hypotheses, prioritized for the confirmed iPhone/cross-field scope

1. **Unconfirmed shared iOS caret placement/first-focus or bidi interaction.** The cross-field symptom “select all then delete works” is consistent with Backspace occurring at offset zero, or selection resetting after touch focus, but neither has been observed here. Inspect actual-input computed direction, touch-placed selection and first-focus timing across TextField and raw inputs. Most inputs already use LTR; the rate inherits it. Collect offsets and event order instead of assuming `text-end` or Arabic layout is wrong. Test alignment as one isolated variable only after recording the unmodified failure.
2. **Unconfirmed shared iOS input event / Drawer interaction or deployed-build mismatch.** Check whether a delete input event reaches React, whether a sheet remounts, whether computed selection behavior changes inside the Drawer, and whether the affected deployment matches the inspected commit. Compare the same `WalletForm` inside its sheet and outside in onboarding; do not infer that the owner has verified the outside-Drawer case. No source evidence currently establishes a Base UI bug.
3. **State overwrite remains a diagnostic branch, not a demonstrated common cause.** Most amount fields already store the DOM string synchronously. A trace must show a changed DOM value restored by rendering before recommending a shared controlled-state fix. Include first deletion from derived Received, which is the special state boundary.

**Separate confirmed defect:** due-day sanitization discards Arabic digits and rewrites controlled text. `/\D/` removes `١`/`٢`, so Arabic day input can disappear immediately. Correct it independently, but do not present its repair as resolving iPhone deletion across all native numeric fields.

Pattern comparison: raw-string money fields are the existing good state-handling pattern; due-day fields are the two filtering outliers. Their presence does not account for the owner's broader symptom. The custom keypad's pure backspace already has basic coverage and cannot explain a native keyboard selection workaround. Existing e2e tests mostly use `.fill()` and inspect RTL/display direction, so they do not exercise first touch focus, caret placement or single-character deletion.

## Proposed design/spec

### Shared editing policy

- Keep native `type="text"`, `dir="ltr"`, `inputMode="decimal"` for USD or `"numeric"` for LBP/rates/days, autocomplete off. Put the direction on the actual input, including the rate field, for an explicit local contract; the formula and labels retain current layout. Do not use `type="number"`, `tel`, `dir="auto"`, a Latin `lang` override, or keyboard interception as a shortcut.
- The controlled value is exactly `e.currentTarget.value`, stored synchronously. Preserve emptiness, trailing separators, leading zeros and invalid pasted text for correction. Validation may reject invalid text, but must not replace it with zero, the previous valid amount or formatted display text. Do not insert grouping, translate digit glyphs, trim, slice, or parse into the live input value.
- Derive parsed values independently and validate again on the server. Keep field-specific semantics: empty required money/rate is unsavable; empty wallet opening/paid-before is zero; empty budget limit/monthly/due day is null. Preserve the distinction between a budget zero and no budget.
- Native selection and deletion remain browser-owned. No caret positioning on every render/focus, no automatic select-all requirement, and no fallback to unconditional `slice(0,-1)` for native Backspace. A transformation justified by a reproduced platform bug must preserve selection offsets and composition; it is not the default implementation.
- Keep current amount alignment, styles, labels, numeric glyph preference and custom keypad layout. `text-start` with LTR on the input is a possible focused experiment if evidence identifies alignment/caret placement; a global alignment change is not proposed as a proven fix.
- On a real iPhone, first touch focus and keyboard opening must leave a usable caret for deletion without forcing selection. A tap at the end of a value followed by native Backspace must remove the final digit, and repeated Backspace must clear it. Capture initial selection before any scripted `setSelectionRange`; that API is for deterministic range tests, not a substitute for touch-focus reproduction. Apply the same acceptance rule across fields, including raw rate/budget inputs and outside-Drawer onboarding.
- Accept Latin and Arabic-Indic digits regardless of UI locale. Recommend also accepting Eastern Arabic/Persian digits at parse time because installed keyboards can produce them; this is input compatibility, not a new display preference. Preserve existing `.`/`٫` decimal and `,`/`٬` grouping semantics. Do not reinterpret comma as decimal: existing money parsing treats `1,200` as grouped 1200, so silent reinterpretation would change money.

### Separate secondary correction: minimal shared parsing interface

Create `src/lib/numeric-text.ts` with pure, non-React exports:

```ts
export function normalizeNumericDigits(input: string): string;
export function parseOptionalDay(input: string): {
  value: number | null;
  invalid: boolean;
};
```

`normalizeNumericDigits` maps only ASCII/Arabic-Indic/Eastern Arabic digits to ASCII, one code unit per supported digit; it leaves punctuation, spaces and other characters unchanged. It never modifies a component's draft state. `parseOptionalDay` trims for validation, normalizes digits, accepts one or two digits representing 1–31, returns `{value:null,invalid:false}` for empty, and `{value:null,invalid:true}` for other input. Leading-zero `01` is 1; signs, grouping, decimals and three-character `031` are invalid. This avoids silently turning pasted `1x2` into 12.

Existing private money normalization delegates digit mapping to that helper, then applies its existing separator rules. `parseAmount`, `parseRate`, `formatAmount`, `toInputText`, `groupTyped`, `convertAtRate`, action signatures and database value types stay stable. Money remains parsed exclusively through `money.ts`; the new helper itself does no money arithmetic.

The two due-day inputs stop stripping/slicing `onChange`; both derive day value/error through `parseOptionalDay`. Raw day text remains editable at any length; a long invalid paste shows the existing bilingual day error instead of silently truncating. Existing form `canSave` conditions continue to block invalid days.

**Alternative/tradeoff:** Normalizing Arabic glyphs on every change could create a Latin-only editor, but adds caret/composition coordination and overrides the keyboard's text. Keeping raw drafts and normalizing only parsing is smaller and follows the working amount pattern. A new MoneyInput framework or mask would touch every form while leaving the unproven device cause unresolved; do not add one for this item. If Task 1 identifies a common DOM attribute/style defect, apply that correction in `TextField` and the two raw inputs (rate/budget), not in separate per-feature handlers.

## Implementation tasks

### Task 1: Pin the failing boundary before choosing the deletion patch

**Files:** new `e2e/numeric-inputs.spec.ts`; extend `e2e/move.spec.ts` only if its existing flow helpers make that clearer. No new diagnostics package, permanent financial telemetry, configuration change or production route.

**Interfaces consumed:** existing labeled controls, `SheetShell`, the current `value/onChange` state boundary, DOM `selectionStart/selectionEnd`, native InputEvent `inputType`/`isComposing`. Produces a documented failing trace and regression case for the exact affected field, or an explicit unresolved device limitation.

- [ ] Start with an unmodified native iPhone touch reproduction in Arabic on two independent fields (for example salary amount and budget limit), then repeat on rate and wallet amount. Tap to focus a prefilled number, let the keyboard open, tap the end, and press native Backspace without scripted caret positioning or select-all. Record whether the last digit is removed and whether held/repeated Backspace reaches empty. Repeat after blur/refocus. This is the primary regression; forced-caret desktop tests alone cannot reproduce a first-focus bug.
- [ ] Add supporting automated EN/AR regression cases for first focus/tap behavior without explicit selection assignment, then separately set known caret positions for deterministic Backspace/Delete/range assertions. Do not use `.fill("")` as the only deletion test. Distinguish synthetic touch/browser checks from real iOS keyboard evidence.
- [ ] Record the tested iPhone/iOS/browser version, browser vs installed PWA, UI locale, digits preference, keyboard variant/language, deployed revision and initial-value origin. Device class and cross-field report are already owner-confirmed; browser/iOS/keyboard details remain diagnostic metadata, not a request for more approval or a new owner question. Use synthetic amounts only.
- [ ] Temporarily inspect event order from touch/pointer events through focus, keyboard opening, selectionchange, beforeinput/input/change and the first deletion. Record inputType, composition state, selection offsets at each boundary, DOM identity, computed actual-input direction/alignment/user-select and React draft after render. Keep the trace local and ephemeral; do not log notes, wallet names, sessions, or real financial values.
- [ ] Compare inside-sheet wallet amount with onboarding's same `WalletForm` outside a Drawer, plus the budget raw input and rate raw input, on the native iPhone. Inspect the actual input rather than only its wrapper; compare before keyboard open, after keyboard open and after a touch changes selection. Offset zero before Backspace identifies a no-op at the start; a changed DOM value restored afterward identifies overwrite; no input event despite a valid caret points toward keyboard/browser/event interaction. Test one cause at a time, including an isolated alignment experiment if the trace supports it.
- [ ] Confirm the chosen regression fails for the reported reason before modifying that boundary. If emulation passes, retain passing coverage and continue real-device investigation; do not invent a failing test by asserting an unobserved caret rule.

### Task 2: Apply only the evidenced shared iPhone deletion correction and cover all entry paths

**Potential implementation files:** `src/components/ui/text-field.tsx`; raw inputs in `src/components/budget/budgets-sheet.tsx` and `src/components/add/transaction-sheet.tsx`; `src/components/ui/drawer.tsx` or `src/components/ui/sheet-shell.tsx` only if Task 1 demonstrates the sheet boundary causes the problem. Individual amount forms in the inventory need changes only if their traced draft handling is wrong. Test files: `e2e/numeric-inputs.spec.ts`, existing `e2e/move.spec.ts`, `src/components/add/amount-keypad.test.ts`, `src/lib/money.test.ts`.

**Interfaces:** preserve `TextField`'s native input props/ref and label/error linkage, `AmountKeypad`'s `onChange(next:string)`, existing money parsers and all Server Action payloads. Any shared behavior must target numeric/decimal inputs only, leaving names, notes, email and passwords alone.

- [ ] Add explicit `dir="ltr"` to the rate input itself as the local editing contract. Preserve the LTR formula wrapper, bilingual labels and current numeric keyboard. Assert the input's computed direction in AR.
- [ ] Prioritize the actual-input/shared boundary identified by Task 1's iPhone trace: direction, first-focus/touch caret placement, selection reset or Drawer behavior. If a shared CSS/attribute issue is proven, patch it at the common numeric input boundary and mirror it on raw rate/budget inputs. If `select-none` interferes, trial `select-text` on actual numeric inputs first and test Drawer dragging/selection. If state overwrite is proven instead, remove its source and keep raw synchronous updates (as the independent Task 3 day correction does). Do not force the caret to the end on every focus/render or delete the final character irrespective of touch selection. If the common cause is not reproduced, do not claim that a direction cleanup or due-day repair fixed the owner's phone.
- [ ] For each native field in the inventory, cover at least one backspace from a prefilled value, complete clear, and subsequent typing under AR; test a representative TextField plus budget/rate raw controls with full caret/range/paste cases in both languages. Check focus and DOM input identity persist after an edit.
- [ ] Exact representative DOM assertions: `1234`, caret 2 + Backspace→`134`, caret 1; `1234`, caret 2 + Delete→`124`, caret 2; selection [1,3] + inserted `9`→`194`, caret 2; repeated Backspace from end→empty. Repeat using `١٢٣٤`, mixed digits, and decimal `12.50`; selected deletion and paste must follow the same native semantics.
- [ ] Verify drafts `.`, `٫`, `0.`, `٠٫`, `12.`, `١٢٫` stay visible and editable without a forced zero or rollback; incomplete decimals remain unsavable until valid under the existing strict money parser. LBP fractions, too many USD fraction digits, negatives, invalid letters and values above `MAX_MINOR` remain unsavable but correctable. Completed `١٢٫٥٠` parses to 1250 cents.
- [ ] Assert field-specific empty semantics from the proposed spec, especially budget empty vs `0`. Mock action boundaries in a focused integration test only if needed to prove payloads; the unconfigured demo must continue to report preview on an attempted valid save, with no real database needed for editing tests.
- [ ] Add an exchange regression: with a derived Received value, delete one digit; it becomes manually owned text. Clear it, change rate/source amount and verify it stays empty and Save disabled. Restore via the existing Use rate action and verify derivation resumes. Do not change currency-switch/reset semantics here; coordinate those with item 6.
- [ ] Extend pure keypad tests to repeated backspace `54.2→54.→54→5→empty`, LBP `400000` deletion, and long-value limit behavior. Keep `groupTyped` on the display only. Native keyboard tests do not certify the keypad, and keypad tests do not certify native inputs. Hardware typing/paste support for the primary Add amount is currently absent and is outside this deletion fix unless the orchestrator explicitly expands scope.

### Task 3: Correct the separate proven due-day digit/filter defect

**Files:** create `src/lib/numeric-text.ts`, `src/lib/numeric-text.test.ts`; modify `src/lib/money.ts`, `src/lib/money.test.ts`, `src/components/fixed/fixed-sheet.tsx`, `src/components/installments/installment-sheet.tsx`; add matching cases to `e2e/numeric-inputs.spec.ts`.

**Interfaces consumed/produced:** exact helper signatures above; existing `fixedInputSchema` and `installmentInputSchema` still receive `dueDay: number | null`. No feature action signature changes.

- [x] Add pure tests for digit mapping: `12`, `١٢`, `۱۲`, and mixed `1٢۳` map to ASCII; decimal/grouping punctuation remains unchanged in this helper. Add `parseOptionalDay` table cases: empty/whitespace→null valid, `1`/`01`/`٣١`/`۳۱`→1/1/31/31 valid; `0`, `32`, `031`, `1x2`, `1.2`, `١٫٢`, `-1`, `1,2`→invalid null.
- [x] Write browser regressions for both due-day fields and the shared selection/draft contract in `e2e/numeric-inputs.spec.ts`. Browser execution is pending the parent-coordinated server; the tests have not been reported as passing.
- [ ] Run the new targeted tests and record the expected failing assertions, then implement the two helpers and raw due-day state update. Wire parsed `value`/`invalid` into the existing error and save logic.
- [x] Add money-boundary cases in `numeric-text.test.ts` so Arabic/Latin/Eastern Arabic versions of `12.50`/`١٢٫٥٠`/`۱۲٫۵۰` all parse to USD 1250; `١٬٥٠٠`/`۱٬۵۰۰` parse to LBP 1500; rates `٨٩٥٠٠`/`۸۹۵۰۰` parse to 89500. Preserve invalid-decimal, negative, empty and overflow behavior. Delegate only digit mapping in money's private normalizer; do not change grouping or rounding rules.
- [ ] Run the targeted unit/browser tests again; require PASS. Check actions still receive number/null days and integer minor units, including existing zod rejection of out-of-range inputs.

### Task 4: Verify actual mobile keyboards and hand back evidence

**Files:** test assertions in `e2e/numeric-inputs.spec.ts`; execution results/screenshots reported to the orchestrator for its shared record. No additional documentation file is assigned to this item during planning.

- [ ] Run the future commands below after implementation; report pass/fail and environment limitations separately. Keep locale parameterization inside the spec: current Playwright projects are device projects, not separate EN/AR projects.
- [ ] Test 390px EN/AR light/dark screenshots for edited native fields and Add keypad; run no-horizontal-overflow checks at 320/390/430/768/1280 and landscape phone. Preserve labels, error associations, keyboard focus, selection menus, sheet close/drag and reachable Save.
- [ ] **Primary acceptance on a real iPhone:** use the owner's browser/keyboard context when available; otherwise begin with Safari and installed Arabic/Latin keyboards and report the exact tested combination. For every numeric field in the inventory, test first touch focus, keyboard opening, tap end/middle, one Backspace, held/repeated Backspace, clear-and-retype, select-range deletion, long-press caret/selection, paste and dismissal/refocus. Include rate/budget raw inputs and compare wallet entry inside and outside the Drawer. Run both Latin and Arabic digits in EN/AR, without scripted selection repair. Include installed PWA/other browser if that is the reported context. Native keyboards may not expose forward Delete; test it separately with hardware/simulation.
- [ ] On a real Android phone (Chrome + Arabic Gboard), run the corresponding focus, tap, deletion, selection, paste, language-switch and composition cases as regression coverage. Android passing does not establish resolution of the owner-confirmed iPhone bug.
- [ ] Compare locale/device keyboard decimal output. `inputMode` is a keyboard hint; it does not guarantee key glyphs, decimal key, minus, or event sequence. Preserve current comma grouping interpretation. If the owner's keyboard emits decimal comma, record an explicit parsing product decision for the orchestrator rather than silently mapping comma to dot.
- [ ] Mark the owner's reported symptom resolved only when the affected native iPhone browser/keyboard or an equivalent confirmed reproduction passes the cross-field first-focus and touch-caret deletion steps. If unavailable, report “automated deletion checks passed; native iPhone keyboard validation pending,” with the device matrix still open. A passing due-day Arabic-digit test is a separate result.

## Reproduction and acceptance matrix

| Axis | Required coverage | What it proves / limitation |
| --- | --- | --- |
| UI locale | `/en` and `/ar` | Layout/label parity and DOM direction, independent of keyboard language. |
| Draft origin | Empty new form; Latin prefill; Arabic typed; mixed paste; derived Received | No initialization or derivation restores removed digits. |
| iPhone focus/selection | First touch focus; keyboard opening; tap end/middle; blur/refocus; inside/outside Drawer | Detects placement/reset issues that deterministic `setSelectionRange` tests can mask. Record unmodified offsets and actual-input direction. |
| Numeric fields | Every inventory field; primary Add keypad separately | Shared fix reaches TextField and raw inputs without claiming the keypad is a text input. |
| Browser automation | `desktop`, `android`, `iphone`, `mobile-small` projects | Browser editing, layout and selection APIs; WebKit/iPhone emulation is not iOS's native keyboard/IME. |
| Physical keyboards | Primary: iPhone Arabic/Latin, owner browser/keyboard variant when identified. Secondary: Android Arabic/Latin. | Native key events, composition, touch caret placement and selection. Native iPhone validation is required before claiming the owner's cross-field symptom resolved. |
| Precision | USD two decimals; LBP integer; zero, max, overflow, invalid paste | Money remains exact; no new silent rounding, unit changes or grouping reinterpretation. |
| Cross-feature state | Derived Received manual edit; budget null vs zero; day null vs invalid | Correct values and Save rules survive deletion. |

## Future verification commands (not run during planning)

```powershell
pnpm exec vitest run src/lib/numeric-text.test.ts src/lib/money.test.ts src/components/add/amount-keypad.test.ts src/features/installments/schema.test.ts src/messages/messages.test.ts
pnpm typecheck
pnpm lint
pnpm exec playwright test e2e/numeric-inputs.spec.ts --project=desktop --project=android --project=iphone --project=mobile-small
pnpm exec playwright test e2e/move.spec.ts e2e/phase3.spec.ts e2e/fixed.spec.ts e2e/installments.spec.ts e2e/salary.spec.ts e2e/budgets.spec.ts
```

Expected: all selected unit tests pass, typecheck/lint exit 0, browser assertions pass for both locale loops and configured projects; screenshot/layout and physical-device checks recorded separately. Existing Playwright configuration starts Next dev in unconfigured demo mode; running these commands belongs to implementation, not this planning turn. Do not run `db:reset`, generate database types, or start Supabase for this client-only correction. Use authenticated staging only if an orchestrator-coordinated action-payload test needs persistence; never use real financial records for diagnostics.

## Migration, RLS, security and atomicity

No database/schema migration, SQL tests or RLS-policy change is required. Raw drafts remain local component state; only validated number/null days and integer money values reach existing actions. Existing zod validation and actionClient session checks remain mandatory, and database ownership/tenant checks remain authoritative. Do not accept a client-submitted user_id or bypass RLS to diagnose entry.

No new mutation or partial write is introduced. In particular, do not change transfer/balance/installment atomicity or the current optional remembered-rate write as part of an input fix; any transactional redesign belongs to the relevant orchestrator item. Invalid or empty required numeric text must never result in an action call merely because the editor accepts it as a draft.

## Dependencies, shared ownership and sequencing

- **Item 6 currency work:** highest overlap in `src/lib/money.ts`, `src/lib/money.test.ts`, `src/components/add/transaction-sheet.tsx`, `src/components/add/amount-keypad.tsx`, wallet forms and currency keyboard/precision decisions. Keep digit normalization independent of the supported currency set; let item 6 own currency metadata, conversion behavior, currency-switch semantics and migrations. Land or agree the small normalization interface first, then rebase/reconcile parser tests and the inputMode source against item 6's final types. Never duplicate a currency decimal table in this fix.
- **Other form work:** fixed/installment/day changes touch `fixed-sheet.tsx` and `installment-sheet.tsx`; salary/wallet/budget forms may be concurrent. Coordinate file ownership before implementation. Keep changes local to raw draft handling and derived validation; preserve new submit payloads and other sessions' edits.
- `TextField` and Drawer are shared with auth/name/note forms, so any evidenced shared patch must be scoped and regression-checked there. No broad primitive rewrite is needed to fix the confirmed day parser issue.
- `src/messages/en.json` and `ar.json` should need no new strings: retain existing amount/day errors. If device evidence requires a new visible validation message, add both translations in the same change and coordinate ownership.
- Parent owns `docs/plans/round-3/README.md`; this session writes only this plan. Do not pick schema numbers from older `docs/plans` files.

## Material unresolved information for the orchestrator

1. iPhone and cross-field native number-keyboard deletion failure are now owner-confirmed. Remaining environment unknowns are iOS version, browser (Safari/PWA/other) and keyboard variant. Record these during available native iPhone validation; do not ask the owner another question in this planning session. No observed selection/event trace yet establishes the shared cause. The due-day digit filter is a separate defect, not a candidate explanation for all inputs.
2. The current source already uses LTR raw-string native amount editing, and the primary Add amount is not a text input. Verify the reported deployment matches this source and inspect actual-input direction/touch selection before treating alignment as the cause. Whether outside-Drawer onboarding has the same failure remains an explicit diagnostic comparison rather than an owner-confirmed distinction.
3. If the physical keyboard emits decimal comma, supporting it conflicts with existing comma-as-grouping parsing. Recommended default for this item is to preserve current semantics; consolidate any broader locale-number grammar change with item 6 before implementation.

## Official references supporting the recommendations

- React documents caret problems caused by transforming controlled values, asynchronous updates or remounting, and recommends synchronous DOM-value updates: [React input troubleshooting](https://react.dev/reference/react-dom/components/input#my-input-caret-jumps-to-the-beginning-on-every-keystroke).
- Keyboard layouts vary and inputMode does not perform validation: [MDN inputmode](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode).
- Text inputs expose a selection range that supports deliberate caret/range regression assertions: [MDN setSelectionRange](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/setSelectionRange).

Self-review: owner-confirmed iPhone/cross-field scope incorporated; first-focus/touch selection and shared actual-input direction prioritized; due-day filtering kept separate from the unresolved common cause; all numeric surfaces inventoried; raw/partial/selection/paste/composition tests assigned; native iPhone validation required; currency/form conflicts identified; no implementation, approval request, migration number or commit step included. Execution order is Task 1 → Task 2 → Task 3 → Task 4; the independent day-parser task may be coordinated separately without holding up investigation of the iPhone issue.

## Bounded implementation evidence and handoff (2026-11-04)

This section supersedes the earlier planning-only status. The original investigation record above describes what was available at planning time, not the later checks recorded here. Full Task 1 device reproduction and Task 4 physical checks remain open.

### Implemented within the lease

- [x] Added `src/lib/numeric-text.ts` and its tests. Digit mapping is parse-only, preserves punctuation and accepts Latin, Arabic-Indic and Eastern Arabic digits. Due days retain raw state and validate separately in both fixed and installment forms.
- [x] Changed only digit normalization delegation in `src/lib/money.ts`. No currency, precision, formatting or conversion API was changed; item 6 may now take that lease.
- [x] Added a shared actual-input policy to `TextField`, inferred from `inputMode="numeric"`/`"decimal"`, with public `numericInputProps` and `numericInputClassName` for raw controls. The policy sets text type, LTR, autocomplete off, spellcheck off, native text selection, bidi isolation, logical start alignment and `data-base-ui-swipe-ignore=""`. It installs no focus/key/input/selection handler and performs no value transformation. Existing nonnumeric fields and caller handlers stay intact.
- [x] Added a focused jsdom component test for the numeric policy, raw partial/invalid text, DOM identity, provided selection across rerender, simulated delete/paste/cut/composition results and label/error associations. These tests do not claim to drive a native mobile keyboard.
- [x] Added EN/AR browser regressions for first-touch focus without forced caret positioning; deterministic caret/range deletion; raw drafts; inside/outside-Drawer wallet entry; funding, salary, fixed, installments, budget and exchange Received paths. E2E tests are saved for the coordinated browser phase.

### Source evidence and rulings

- **Ruling: local input touch opt-out, not a Drawer rewrite.** Further inspection found that `DrawerContent` already has `select-text`. Installed Base UI `DrawerViewport.js` protects expanded input selections but allows other touch gesture arbitration; the [official Drawer documentation](https://base-ui.com/react/components/drawer) explains that Content's default text-selection protection applies to mouse input and documents `data-base-ui-swipe-ignore` for descendants handling touch gestures. Set the documented opt-out on numeric inputs so touch caret gestures belong to the input. This fixes an identifiable missing touch affordance, but is not proof it caused the owner's Backspace symptom. Cost if that hypothesis is incomplete: the device issue can remain and must be diagnosed on the iPhone; there is no fake deletion fallback masking it.
- **Ruling: explicit numeric input policy, browser-owned caret.** Shared `TextField` had no own numeric contract and raw budget/rate inputs bypass it. The small policy makes actual input direction/selection consistent without rewriting values. Logical start alignment prevents a surrounding RTL alignment inheritance from defining numeric text placement. No global Drawer, swipe, locale or typography redesign was made. Cost if a context requires end alignment: the raw caller can choose its alignment deliberately when integrating; do not change caret handling to compensate.
- **Ruling: bounded verification.** The parent prohibited app-server/browser runs and global checks during concurrent edits. Scoped unit/component checks and TypeScript diagnostics were run instead; parent owns global integration and browser execution. No physical iPhone, hosted data, migrations, secrets, git staging or commit was used. Per-plan execution records stay here because no extra ledger file was leased.

### Checks actually run

1. RED: `pnpm exec vitest run src/lib/numeric-text.test.ts src/components/ui/text-field.test.tsx` failed with the expected missing helper module and two actual-input direction policy assertions (`''` vs `ltr`). Eighteen existing raw-editing assertions already passed, consistent with the earlier source investigation.
2. GREEN: `pnpm exec vitest run src/lib/numeric-text.test.ts src/lib/money.test.ts src/components/ui/text-field.test.tsx src/features/installments/schema.test.ts` passed **4 files / 75 tests**.
3. Targeted ESLint on the helper/tests/primitive/E2E file exited 0.
4. A scoped TypeScript compiler-API check using the existing tsconfig options, `incremental:false`, `noEmit:true`, and only those numeric helper/primitive/E2E entry files exited 0. This was not a global application typecheck.
5. Playwright `--list` loaded the new numeric spec without starting a server/browser. Test listing is discovery only, not a passing E2E result.
6. Impeccable mechanical detection on `text-field.tsx`, `fixed-sheet.tsx` and `installment-sheet.tsx` returned `[]`. No screenshots or browser inspection were performed.

### Exact remaining integration outside this lease

Parent/item owners must apply the shared exports to the raw budget and exchange-rate inputs. Received already uses `TextField`, so it receives the policy automatically; do not add a second value handler there.

```tsx
import { numericInputProps, numericInputClassName } from "@/components/ui/text-field";

// In budgets-sheet.tsx and the raw move-rate input in transaction-sheet.tsx:
<input
  {...numericInputProps}
  inputMode={/* the owner's currency-specific mode, or numeric for rate */}
  value={rawDraft}
  onChange={/* existing raw-string state handler */}
  className={cn(existingInputClasses, numericInputClassName)}
  // retain current id, label association, error and placeholder props
/>
```

Use the existing `cn` helper (budget currently needs its import); putting the shared class last makes the numeric logical-start alignment win over the budget input's current `text-end`. Keep the rate's LTR formula wrapper and add the policy to its actual input. Preserve Received's first-edit/manual flag and raw string; the shared `TextField` needs no per-form replacement. All new numeric controls in other round-3 items should use `TextField` with the correct `inputMode`, or these same raw-input exports.

The browser spec intentionally expects this policy on raw budget/rate inputs; those checks will remain unsatisfied until their owners integrate it. Run the saved spec only after shared form/currency work and the coordinated test server are ready. Native iPhone first-focus/backspace validation remains mandatory before reporting the owner's cross-field bug resolved. The separate due-day parsing correction is implemented and unit-verified.
