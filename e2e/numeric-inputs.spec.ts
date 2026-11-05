import { expect, test, type Locator, type Page } from "@playwright/test";
import en from "../src/messages/en.json";
import ar from "../src/messages/ar.json";
import { expectNoHorizontalOverflow } from "./support";

// These are browser editing regressions, including emulated touch before focus.
// Playwright's iPhone project does not exercise the physical iOS number keyboard.
async function expectNumericPolicy(input: Locator) {
  await expect(input).toHaveAttribute("type", "text");
  await expect(input).toHaveAttribute("dir", "ltr");
  await expect(input).toHaveAttribute("data-base-ui-swipe-ignore", "");
  await expect(input).toHaveCSS("direction", "ltr");
  await expect(input).toHaveCSS("unicode-bidi", "isolate");
  await expect(input).toHaveCSS("user-select", "text");
}

async function placeCaret(input: Locator, start: number, end = start) {
  await input.focus();
  await input.evaluate((element, selection) => {
    (element as HTMLInputElement).setSelectionRange(selection.start, selection.end);
  }, { start, end });
}

async function expectCaret(input: Locator, start: number, end = start) {
  await expect.poll(() => input.evaluate((element) => {
    const input = element as HTMLInputElement;
    return [input.selectionStart, input.selectionEnd];
  })).toEqual([start, end]);
}

async function expectClearAndRetype(input: Locator) {
  await input.fill("١٢٣٤");
  await placeCaret(input, 4);
  for (const expected of ["١٢٣", "١٢", "١", ""]) {
    await input.press("Backspace");
    await expect(input).toHaveValue(expected);
  }
  await input.press("5");
  await expect(input).toHaveValue("5");
}

async function tapAfterText(input: Locator) {
  await input.evaluate((element) => (element as HTMLInputElement).blur());
  const box = await input.boundingBox();
  if (!box) throw new Error("Numeric input must be visible before touch focus");
  const position = { x: box.width - 18, y: box.height / 2 };
  if (test.info().project.use.hasTouch) await input.tap({ position });
  else await input.click({ position });
}

for (const locale of ["en", "ar"] as const) {
  const copy = locale === "ar" ? ar : en;

  async function openSalary(page: Page) {
    await page.goto(`/${locale}`);
    await page.getByRole("region", { name: copy.Salary.title })
      .getByRole("button", { name: copy.Salary.edit, exact: true }).click();
    return page.getByRole("dialog").getByLabel(copy.Salary.amount, { exact: true });
  }

  test(`${locale}: first touch focus deletes a prefilled amount without selecting all`, async ({ page }) => {
    const input = await openSalary(page);
    const initial = await input.inputValue();
    expect(initial.length).toBeGreaterThan(0);
    await expectNumericPolicy(input);
    // Do not call setSelectionRange here: this case catches touch-placement errors.
    await tapAfterText(input);
    await expectCaret(input, initial.length);
    await input.press("Backspace");
    await expect(input).toHaveValue(initial.slice(0, -1));
    await expectCaret(input, initial.length - 1);
    await tapAfterText(input);
    for (let remaining = initial.length - 1; remaining > 0; remaining--) {
      await input.press("Backspace");
      await expect(input).toHaveValue(initial.slice(0, remaining - 1));
    }
    await input.press("7");
    await expect(input).toHaveValue("7");
    await expectNoHorizontalOverflow(page);
  });

  test(`${locale}: native caret, forward delete, range replacement and partial decimals remain editable`, async ({ page }) => {
    const input = await openSalary(page);
    await input.fill("1234");
    await placeCaret(input, 2);
    await input.press("Backspace");
    await expect(input).toHaveValue("134");
    await expectCaret(input, 1);
    await input.fill("1234");
    await placeCaret(input, 2);
    await input.press("Delete");
    await expect(input).toHaveValue("124");
    await expectCaret(input, 2);
    await input.fill("١٢٣٤");
    await placeCaret(input, 1, 3);
    await input.press("9");
    await expect(input).toHaveValue("١9٤");
    await expectCaret(input, 2);
    for (const draft of ["", ".", "٫", "0.", "٠٫", "12.", "١٢٫", "1٢٫۵0", "1x2"]) {
      await input.fill(draft);
      await expect(input).toHaveValue(draft);
    }
    await input.fill("١٢٫٥٠");
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await expectClearAndRetype(input);
  });

  test(`${locale}: wallet entry outside the Drawer preserves touch focus and native deletion`, async ({ page }) => {
    await page.goto(`/${locale}/onboarding`);
    await page.getByRole("button", { name: copy.Onboarding.continue, exact: true }).click();
    const input = page.getByLabel(copy.Wallets.amount, { exact: true });
    await expectNumericPolicy(input);
    await input.fill("1234");
    await tapAfterText(input);
    await expectCaret(input, 4);
    await input.press("Backspace");
    await expect(input).toHaveValue("123");
    await expectClearAndRetype(input);
    await expectNoHorizontalOverflow(page);
  });

  test(`${locale}: raw budget input follows the same numeric editing contract`, async ({ page }) => {
    await page.goto(`/${locale}/budgets`);
    await page.getByRole("button", { name: copy.Budgets.edit, exact: true }).click();
    const dialog = page.getByRole("dialog");
    const input = dialog.locator('input[inputmode="decimal"], input[inputmode="numeric"]').first();
    await expectNumericPolicy(input);
    await expectClearAndRetype(input);
    await input.fill("");
    await expect(input).toHaveValue("");
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await input.fill("0");
    await expect(input).toHaveValue("0");
    await expectNoHorizontalOverflow(page);
  });

  test(`${locale}: wallet opening and explicit cross-currency Move amounts preserve native deletion inside the Drawer`, async ({ page }) => {
    await page.goto(`/${locale}/wallets`);
    await page.getByRole("button", { name: copy.Wallets.add, exact: true }).click();
    const dialog = page.getByRole("dialog");
    const amount = dialog.getByLabel(copy.Wallets.amount, { exact: true });
    await expectNumericPolicy(amount);
    await expectClearAndRetype(amount);
    await dialog.getByRole("combobox", { name: copy.Wallets.defaultCurrency }).selectOption("LBP");
    await expect(amount).toHaveAttribute("inputmode", "numeric");
    await expectClearAndRetype(amount);
    await page.goto(`/${locale}`);
    await page.getByRole("button", { name: copy.Nav.add, exact: true }).filter({ visible: true }).click();
    const move = page.getByRole("dialog");
    await move.locator("label").filter({ hasText: new RegExp(`^${copy.Add.move}$`) }).click();
    await move.getByRole("combobox", { name: copy.Add.from, exact: true }).selectOption({ label: "Pocket" });
    await move.getByRole("combobox", { name: copy.Add.fromCurrency, exact: true }).selectOption({ label: "USD" });
    await move.getByRole("combobox", { name: copy.Add.to, exact: true }).selectOption({ label: "Bank" });
    await move.getByRole("combobox", { name: copy.Add.toCurrency, exact: true }).selectOption({ label: "LBP" });
    await move.getByRole("button", { name: "1", exact: true }).click();
    await move.getByRole("button", { name: copy.Add.editReceived, exact: true }).click();
    const received = move.getByLabel(copy.Add.received.replace("{currency}", "LBP"), { exact: true });
    await expectNumericPolicy(received);
    await expectClearAndRetype(received);
    await expectNoHorizontalOverflow(page);
  });

  test(`${locale}: prefilled installment payment deletes through empty without reverting to the amount due`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await page.getByRole("button", { name: copy.Installments.payAgainItem.replace("{name}", "Laptop"), exact: true }).click();
    const input = page.getByRole("dialog").getByLabel(copy.Installments.amount, { exact: true });
    await expectNumericPolicy(input);
    await expectClearAndRetype(input);
    await expectNoHorizontalOverflow(page);
  });

  test(`${locale}: fixed due day retains Arabic digits and rejects invalid paste without filtering`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await page.getByRole("region", { name: copy.Fixed.title })
      .getByRole("button", { name: copy.Fixed.addFixed, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expectClearAndRetype(dialog.getByLabel(copy.Fixed.amount, { exact: true }));
    const input = dialog.getByLabel(copy.Fixed.dueDay, { exact: true });
    await expectNumericPolicy(input);
    await input.fill("١٢");
    await expect(input).toHaveValue("١٢");
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await input.press("Backspace");
    await expect(input).toHaveValue("١");
    await input.press("Backspace");
    await expect(input).toHaveValue("");
    await input.fill("1x2");
    await expect(input).toHaveValue("1x2");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await input.fill("٣١");
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await input.fill("۳۲");
    await expect(input).toHaveAttribute("aria-invalid", "true");
  });

  test(`${locale}: installment numeric fields retain their drafts and day validation`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await page.getByRole("region", { name: copy.Fixed.title })
      .getByRole("button", { name: copy.Fixed.addFixed, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText(copy.Installments.installment, { exact: true }).click();
    await dialog.getByRole("button", { name: copy.Installments.startedBefore, exact: true }).click();
    for (const label of [copy.Installments.total, copy.Installments.paidBefore, copy.Installments.monthlyAmount]) {
      const input = dialog.getByLabel(label, { exact: true });
      await expectNumericPolicy(input);
      await expectClearAndRetype(input);
    }
    const day = dialog.getByLabel(copy.Installments.dueDay, { exact: true });
    await day.fill("١٢");
    await expect(day).toHaveValue("١٢");
    await day.press("Backspace");
    await expect(day).toHaveValue("١");
    await day.fill("031");
    await expect(day).toHaveValue("031");
    await expect(day).toHaveAttribute("aria-invalid", "true");
    await day.fill("");
    await expect(day).not.toHaveAttribute("aria-invalid", "true");
  });

  test(`${locale}: first deletion of derived Received becomes a manual draft and is never refilled by a rate edit`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await page.getByRole("button", { name: copy.Nav.add, exact: true }).filter({ visible: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText(copy.Add.move, { exact: true }).click();
    await dialog.getByRole("button", { name: "5", exact: true }).click();
    await dialog.getByRole("combobox", { name: copy.Add.to, exact: true }).selectOption({ label: "Bank" });
    await dialog.getByRole("combobox", { name: copy.Add.toCurrency, exact: true }).selectOption({ label: "LBP" });
    const rate = dialog.getByLabel(copy.Add.rate, { exact: true });
    const received = dialog.getByLabel(copy.Add.received.replace("{currency}", "LBP"), { exact: true });
    await expectNumericPolicy(rate);
    await expectNumericPolicy(received);
    await rate.fill("89500");
    const derived = await received.inputValue();
    expect(derived.length).toBeGreaterThan(0);
    await expect(received).toHaveAttribute("readonly", "");
    await dialog.getByRole("button", { name: copy.Add.editReceived, exact: true }).click();
    await expect(received).not.toHaveAttribute("readonly", "");
    await placeCaret(received, derived.length);
    await received.press("Backspace");
    await expect(received).toHaveValue(derived.slice(0, -1));
    await received.fill("");
    await rate.fill("90000");
    await expect(received).toHaveValue("");
    await expect(dialog.getByRole("button", { name: copy.Add.moveSave, exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: copy.Add.useRate, exact: true }).click();
    await expect(received).not.toHaveValue("");
    await expect(received).toHaveAttribute("readonly", "");
    await expectNoHorizontalOverflow(page);
  });
}
