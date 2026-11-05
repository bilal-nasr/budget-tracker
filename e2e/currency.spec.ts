import { expect, test } from "@playwright/test";
import en from "../src/messages/en.json";
import ar from "../src/messages/ar.json";
import { expectNoHorizontalOverflow } from "./support";

for (const locale of ["en", "ar"] as const) {
  const messages = locale === "en" ? en : ar;
  test(`${locale}: SYP wallet creation uses whole-pound amounts`, async ({ page }) => {
    await page.goto(`/${locale}/wallets`);
    await expect(page.getByRole("combobox", { name: messages.Wallets.displayCurrency, exact: true })).toBeVisible();
    await page.getByRole("button", { name: messages.Wallets.add, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: messages.Wallets.defaultCurrency, exact: true }).selectOption("SYP");
    const amount = dialog.getByLabel(messages.Wallets.amount, { exact: true });
    await expect(amount).toHaveAttribute("inputmode", "numeric");
    await amount.fill("١٢٥٠");
    await dialog.getByLabel(messages.Wallets.name, { exact: true }).fill("محفظة سورية Synthetic wallet");
    await expect(dialog.getByRole("button", { name: messages.Wallets.create, exact: true })).toBeEnabled();
    await expectNoHorizontalOverflow(page);
  });

  test(`${locale}: global currency selection keeps every wallet and its default at 320px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`/${locale}/wallets`);
    const selector = page.getByRole("combobox", { name: messages.Wallets.displayCurrency, exact: true });
    await expect(page.getByRole("combobox")).toHaveCount(1);
    const wallets = page.getByRole("list", { name: messages.Nav.wallets, exact: true });
    const names = await wallets.getByRole("button").allTextContents();
    expect(names.length).toBeGreaterThan(0);
    const defaults = await wallets.locator("button").evaluateAll((buttons) => buttons.map((button) => button.querySelector("span.min-w-0 > span:last-child")?.textContent));
    for (const code of ["LBP", "SYP", "USD"]) {
      await selector.selectOption(code);
      await expect(wallets.getByRole("button")).toHaveCount(names.length);
      await expect(wallets).not.toContainText(messages.Wallets.balanceUnavailable);
      expect(await wallets.locator("button").evaluateAll((buttons) => buttons.map((button) => button.querySelector("span.min-w-0 > span:last-child")?.textContent))).toEqual(defaults);
      await expect(wallets.locator(".amount").first()).toHaveAttribute("dir", "ltr");
      await expectNoHorizontalOverflow(page);
    }
    // Stress the rendered amount's layout independently of the demo catalog.
    // The formatter's custom precision is verified by component tests.
    await wallets.locator(".amount").first().evaluate((node) => { node.textContent = "LONGSYMBOL12 90,071,992.54740991"; });
    await expect.poll(() => wallets.locator(".amount").first().evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(page);
    await wallets.getByRole("button").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("combobox", { name: messages.Wallets.defaultCurrency, exact: true })).toBeVisible();
    await expect(dialog.getByLabel(messages.Wallets.amount, { exact: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  for (const [from, to, destination] of [
    ["Cash USD", "Syrian cash SYP", "SYP"],
    ["Syrian cash SYP", "Cash USD", "USD"],
    ["Cash LBP", "Syrian cash SYP", "SYP"],
    ["Syrian cash SYP", "Cash LBP", "LBP"],
  ] as const) {
    test(`${locale}: ${from} to ${to} requires explicit actual received editing`, async ({ page }) => {
      await page.goto(`/${locale}`);
      await page.getByRole("button", { name: messages.Nav.add, exact: true }).filter({ visible: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator("label").filter({ hasText: new RegExp(`^${messages.Add.move}$`) }).click();
      const fromControl = dialog.getByRole("combobox", { name: new RegExp(`^${messages.Add.from}`) });
      const toControl = dialog.getByRole("combobox", { name: new RegExp(`^${messages.Add.to}`) });
      await fromControl.click();
      await page.getByRole("option", { name: from, exact: true }).click();
      await toControl.click();
      await expect(page.getByRole("option", { name: from, exact: true })).toHaveCount(0);
      await page.getByRole("option", { name: to, exact: true }).click();
      await dialog.getByRole("button", { name: "1", exact: true }).click();
      const received = dialog.getByLabel(messages.Add.received.replace("{currency}", destination));
      await expect(received).toHaveAttribute("readonly", "");
      await expect(received).toHaveValue("");
      await expect(dialog.getByLabel(messages.Add.rate, { exact: true })).toHaveCount(0);
      const save = dialog.getByRole("button", { name: messages.Add.moveSave, exact: true });
      await expect(save).toBeDisabled();
      await dialog.getByRole("button", { name: messages.Add.editReceived }).click();
      await expect(received).toBeEditable();
      await expect(received).toBeFocused();
      await received.fill(destination === "USD" ? "١٢٫٥٠" : "١٢٥٠");
      await expect(save).toBeEnabled();
      await received.fill("");
      await dialog.getByRole("button", { name: "0", exact: true }).click();
      await expect(received).toHaveValue("");
      await expect(save).toBeDisabled();
      await expect(dialog.getByRole("button", { name: messages.Add.useRate })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    });
  }
  test(`${locale}: SYP budget query shows a separate currency total`, async ({ page }) => {
    await page.goto(`/${locale}/budgets?currency=SYP`);
    await expect(page).toHaveURL(/currency=SYP/);
    await expect(page.locator("main")).toContainText("SYP 1,250");
    await expectNoHorizontalOverflow(page);
  });
  test(`${locale}: invalid or repeated currency queries safely select the default`, async ({ page }) => {
    for (const query of ["currency=EUR", "currency=SYP&currency=USD"]) {
      await page.goto(`/${locale}/budgets?${query}`);
      await expect(page.getByRole("radio", { name: "USD", exact: true })).toBeChecked();
      await expectNoHorizontalOverflow(page);
    }
  });
}
