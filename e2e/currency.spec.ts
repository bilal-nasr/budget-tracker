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
    const editWallets = wallets.getByRole("button", { name: new RegExp(`^${messages.Wallets.editNamed.split("{name}")[0]}`) });
    const names = await editWallets.allTextContents();
    expect(names.length).toBeGreaterThan(0);
    const defaults = await editWallets.evaluateAll((buttons) => buttons.map((button) => button.querySelector("span.min-w-0 > span:last-child")?.textContent));
    for (const code of ["LBP", "SYP", "USD"]) {
      await selector.selectOption(code);
      await expect(editWallets).toHaveCount(names.length);
      await expect(wallets).not.toContainText(messages.Wallets.balanceUnavailable);
      expect(await editWallets.evaluateAll((buttons) => buttons.map((button) => button.querySelector("span.min-w-0 > span:last-child")?.textContent))).toEqual(defaults);
      await expect(wallets.locator(".amount").first()).toHaveAttribute("dir", "ltr");
      await expectNoHorizontalOverflow(page);
    }
    // Stress the rendered amount's layout independently of the demo catalog.
    // The formatter's custom precision is verified by component tests.
    await wallets.locator(".amount").first().evaluate((node) => { node.textContent = "LONGSYMBOL12 90,071,992.54740991"; });
    await expect.poll(() => wallets.locator(".amount").first().evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(page);
    await editWallets.first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("combobox", { name: messages.Wallets.defaultCurrency, exact: true })).toBeVisible();
    await expect(dialog.getByLabel(messages.Wallets.amount, { exact: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test(`${locale}: global wallet keyboard order survives currency changes and preview saves roll back`, async ({ page }, testInfo) => {
    await page.goto(`/${locale}/wallets`);
    const list = page.getByRole("list", { name: messages.Nav.wallets, exact: true });
    const handles = list.getByRole("button", { name: new RegExp(`^${messages.Wallets.reorderNamed.split("{name}")[0]}`) });
    const labels = await handles.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
    expect(labels.length).toBeGreaterThan(1);
    const first = page.getByRole("button", { name: labels[0]!, exact: true });
    await first.focus();
    await first.press("Space");
    await first.press("ArrowDown");
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute("aria-pressed", "true");
    const moved = [labels[1], labels[0], ...labels.slice(2)];
    expect(await handles.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual(moved);
    for (const code of ["SYP", "LBP", "USD"]) {
      await page.getByRole("combobox", { name: messages.Wallets.displayCurrency }).selectOption(code);
      expect(await handles.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual(moved);
      await expectNoHorizontalOverflow(page);
    }
    await first.press("Escape");
    expect(await handles.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual(labels);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await first.press("Enter");
    await first.press("ArrowDown");
    await first.press("Enter");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(messages.Wallets.errorPreview);
    expect(await handles.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual(labels);
    await expect(first).toBeFocused();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `.superpowers/sdd/2026-11-05-global-currencies-all-wallets/task-5-${locale}-${testInfo.project.name}.png`, fullPage: true });
  });

  test(`${locale}: pointer wallet reorder attempts save and recovers the complete order in preview`, async ({ page }) => {
    await page.goto(`/${locale}/wallets`);
    const list = page.getByRole("list", { name: messages.Nav.wallets, exact: true });
    const handles = list.getByRole("button", { name: new RegExp(`^${messages.Wallets.reorderNamed.split("{name}")[0]}`) });
    const labels = await handles.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
    // Keep both rows away from the viewport auto-scroll edge before measuring.
    await handles.nth(0).evaluate((element) => element.scrollIntoView({ block: "center" }));
    const source = await handles.nth(0).boundingBox();
    const target = await handles.nth(1).boundingBox();
    expect(source).not.toBeNull();
    expect(target).not.toBeNull();
    if (!source || !target) throw new Error("Wallet reorder handles must have geometry");
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    // Wait for the pointer sensor to activate and measure rows before completing
    // the gesture. WebKit can otherwise coalesce the entire fast move into pickup.
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2 + 8);
    await expect(handles.nth(0).locator("..")).toHaveClass(/z-10/);
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
    await expect(page.getByRole("main").getByRole("status").first()).toHaveText(messages.Wallets.sortMoved.replace("{name}", labels[0]!.replace(messages.Wallets.reorderNamed.split("{name}")[0], "").replace(messages.Wallets.reorderNamed.split("{name}")[1], "")).replace("{position}", "2").replace("{count}", String(labels.length)));
    await page.mouse.up();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(messages.Wallets.errorPreview);
    expect(await handles.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))).toEqual(labels);
    await expectNoHorizontalOverflow(page);
  });

  for (const [from, fromCurrency, to, destination] of [
    ["Pocket", "USD", "Syrian cash", "SYP"],
    ["Syrian cash", "SYP", "Pocket", "USD"],
    ["Pocket", "LBP", "Syrian cash", "SYP"],
    ["Syrian cash", "SYP", "Pocket", "LBP"],
  ] as const) {
    test(`${locale}: ${from} ${fromCurrency} to ${to} ${destination} requires explicit actual received editing`, async ({ page }) => {
      await page.goto(`/${locale}`);
      await page.getByRole("button", { name: messages.Nav.add, exact: true }).filter({ visible: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator("label").filter({ hasText: new RegExp(`^${messages.Add.move}$`) }).click();
      const fromControl = dialog.getByRole("combobox", { name: messages.Add.from, exact: true });
      const toControl = dialog.getByRole("combobox", { name: messages.Add.to, exact: true });
      await fromControl.selectOption({ label: from });
      await dialog.getByRole("combobox", { name: messages.Add.fromCurrency, exact: true }).selectOption({ label: fromCurrency });
      await expect(toControl.getByRole("option", { name: from, exact: true })).toHaveCount(0);
      await toControl.selectOption({ label: to });
      await dialog.getByRole("combobox", { name: messages.Add.toCurrency, exact: true }).selectOption({ label: destination });
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
