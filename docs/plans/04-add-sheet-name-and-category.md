# 04 · Add sheet: Name field and category dropdown

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. No commit steps (owner commits).

**Goal:** The Add sheet has a visible **Name** field (like the fixed-expense sheet), and categories are picked from a compact dropdown instead of a two-row grid, so the sheet is shorter.

**Owner notes:** "When adding expense also include the name input like the fixed expenses." · "Make the categories like (groceries, health…) as drop down to preserve space."

**Architecture:**
- **Name** reuses the existing `transactions.note` column: rows in Activity already show `note` as the title and fall back to the category name, and fixed-expense payments already store their name there. No migration. Today the note is hidden behind the collapsed "date · Add note" row and the **Aa** key; it moves up to a visible field under the amount. The collapsed row keeps only the date.
- **Category** becomes one `CategorySelect` trigger (glyph + name + chevron, 48px tall) that opens a list of the categories for the current kind. Built on the shadcn `select` primitive (Base UI Select, already the component library) so it is restyled to the tokens and works inside the Drawer. The same component replaces the grid in the fixed-expense sheet (`src/components/fixed/fixed-sheet.tsx`) and is reused by plans 07 and 08.

**Tech stack:** shadcn `select` (Base UI), existing `TextField`, `CategoryGlyph`.

## Global constraints

All of [README § Global constraints](README.md#global-constraints-every-plan-every-task).

## Review focus

- The Select popup must open above the Drawer and stay inside the viewport at 320px wide; Base UI's portal must not break the Drawer's focus trap (test with keyboard and VoiceOver).
- Arabic: options in Arabic names, list aligned to the start edge, chevron not mirrored wrongly.
- Typing a Name opens the phone keyboard; the keypad and Save must stay reachable (the sheet scrolls, Save is sticky). Check iOS Safari.
- Editing an existing transaction pre-fills Name from `note` and the dropdown from `categoryId`.
- Switching Expense ↔ Income clears the category (as today) but keeps the Name.
- An archived or deleted category on an old transaction being edited: the trigger shows it, the list does not offer it.

---

### Task 1: `CategorySelect`

**Files:**
- Create: `src/components/ui/select.tsx` (via `pnpm dlx shadcn@latest add select`, then restyle: 48px trigger, 44px items, `text-base`, tokens from `DESIGN.md`)
- Create: `src/components/categories/category-select.tsx`
- Modify: `src/app/[locale]/dev/kitchen-sink/kitchen-sink.tsx` (add an example)

**Interfaces:**
- Produces:

```ts
export function CategorySelect(props: {
  categories: Category[];          // already filtered to one kind, in display order
  value: string;                   // category id or ""
  onChange: (id: string) => void;
  label: string;                   // accessible name, e.g. t("category")
  placeholder: string;             // "Choose a category"
  invalid?: boolean;
}): React.JSX.Element
```

The trigger has role `combobox` named by `label`; each item is role `option` with the localized name (`categoryName(c, locale)`) in `<bdi>` and its `CategoryGlyph`.

- [ ] **Step 1:** Add and restyle the primitive; implement `CategorySelect`.
- [ ] **Step 2:** Kitchen sink at 320 and 390 in EN and AR, inside an open `SheetShell`: popup fits, no horizontal overflow.

### Task 2: Category dropdown in the Add sheet

**Files:**
- Modify: `src/components/add/transaction-sheet.tsx` (replace the `role="radiogroup"` category grid, delete `VISIBLE_CATEGORIES`, `showAll`, `crowded`, `shown`)
- Test: `e2e/phase3.spec.ts` (update tests that click category radios)

- [ ] **Step 1: Write the failing test** in `e2e/phase3.spec.ts`:

```ts
test("category is a dropdown in the Add sheet", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: "Add", exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", { name: "Groceries" })).toHaveCount(0);
  await dialog.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: "Health" }).click();
  await expect(dialog.getByRole("combobox", { name: "Category" })).toContainText("Health");
  await expectNoHorizontalOverflow(page);
});
```

- [ ] **Step 2:** `pnpm test:e2e e2e/phase3.spec.ts -g "dropdown"`. Expected: FAIL.
- [ ] **Step 3:** Replace the grid with `<CategorySelect categories={list} value={categoryId} onChange={setCategoryId} … />`. Update every existing e2e test that clicks `getByRole("radio", { name: <category> })` to use the combobox + option.
- [ ] **Step 4:** Re-run the whole e2e suite. Expected: PASS.

### Task 3: Visible Name field

**Files:**
- Modify: `src/components/add/transaction-sheet.tsx`, `src/components/transactions/detail-sheet.tsx` (label "Note" → "Name" for expense/income), `src/messages/en.json`, `src/messages/ar.json`
- Test: `e2e/phase3.spec.ts`, `e2e/salary.spec.ts` (the existing "Aa key opens the text field" test)

**Strings (`Add` namespace):** `name` "Name" / "الاسم"; `namePlaceholder` "e.g. Spinneys, taxi to work" / "مثلاً: سبينيز، تاكسي إلى العمل". `Detail.name` "Name" / "الاسم". The Move tab keeps `note` / `notePlaceholder`.

Layout order for Expense and Income: amount row → **Name** (`TextField`, `maxLength={140}`, `enterKeyHint="done"`, `autoComplete="off"`) → Category dropdown → collapsed date row → keypad → Save. The **Aa** key focuses the Name field. The collapsed row reads only the date (`Today ▾`).

- [ ] **Step 1: Write the failing test:**

```ts
test("Name is visible in the Add sheet and becomes the row title", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: "Add", exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog");
  const name = dialog.getByLabel("Name");
  await expect(name).toBeVisible();            // no need to expand anything
  await dialog.getByRole("button", { name: "Aa" }).click();
  await expect(name).toBeFocused();
});
```

(Use the keypad's real accessible name for **Aa**, `Add.text` in `en.json`.)

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Move the note input out of `details` for expense/income, relabel it, wire **Aa** to it. Keep it inside `details` for Move.
- [ ] **Step 4:** Re-run the suite. Expected: PASS. Screenshots at 390px EN/AR: the sheet with Name + dropdown must be no taller than today's sheet with the grid (measure the Save button's `y` before/after and note both here).

### Task 4: Same dropdown in the fixed-expense sheet

**Files:**
- Modify: `src/components/fixed/fixed-sheet.tsx`
- Test: `e2e/fixed.spec.ts` (`getByRole("radio", { name: "Fun" })` → combobox + option)

- [ ] **Step 1:** Update the test first; run it; expected FAIL.
- [ ] **Step 2:** Replace the grid with `CategorySelect`.
- [ ] **Step 3:** Re-run. Expected: PASS.

## Decisions made for the owner

- **Name is optional.** A required name would add typing to every expense and break the "log in under 10 seconds" goal; an empty name falls back to the category name, as rows do today. Say so if you want it required.
- **No pre-selected category.** A remembered last category would keep the tap count at one but risks logging under the wrong category without noticing. Can be added later as an option.
