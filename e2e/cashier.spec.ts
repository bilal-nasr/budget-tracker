import { expect, test, type Page } from "@playwright/test";
import en from "../src/messages/en.json";
import ar from "../src/messages/ar.json";
import { expectNoHorizontalOverflow } from "./support";

// Demo UI verification only; SQL/live-auth suites prove persisted movements.
async function startPurchase(page: Page, locale: "en" | "ar") {
  const m = locale === "ar" ? ar : en;
  await page.goto(`/${locale}`);
  await page.getByRole("button", { name: m.Nav.add, exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog");
  for (const key of ["1", "2", ".", "5"]) await dialog.getByRole("button", { name: key, exact: true }).click();
  await dialog.getByRole("combobox", { name: m.Add.category }).click();
  await page.getByRole("option", { name: locale === "ar" ? "أخرى" : "Other", exact: true }).click();
  await dialog.getByRole("radio", { name: locale === "ar" ? "شراء نقدي" : "Cash purchase" }).click();
  return { dialog, m };
}
for (const locale of ["en", "ar"] as const) {
  test(`${locale} records LBP cost with USD tender and LBP change through Cash purchase mode`, async ({ page }) => {
    const m = locale === "ar" ? ar : en;
    await page.goto(`/${locale}`);
    await page.getByRole("button", { name: m.Nav.add, exact: true }).filter({ visible: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("radio", { name: m.Cashier.standard })).toBeChecked();
    await dialog.getByRole("radio", { name: m.Cashier.cashPurchase }).click();
    await dialog.getByLabel(m.Cashier.purchaseCurrency).selectOption("LBP");
    for (const key of ["3", "4", "000", "000"]) await dialog.getByRole("button", { name: key, exact: true }).click();
    await dialog.getByRole("combobox", { name: m.Add.category }).click();
    await page.getByRole("option", { name: locale === "ar" ? "أخرى" : "Other", exact: true }).click();
    await dialog.getByLabel(m.Cashier.tender).fill("5");
    await dialog.getByRole("button", { name: m.Cashier.addChange, exact: true }).click();
    await dialog.getByLabel(m.Cashier.currency).selectOption("LBP");
    await dialog.getByLabel(m.Cashier.change).fill("110000");
    await expect(dialog.getByLabel(m.Cashier.tender)).toHaveValue("5");
    await expect(dialog.getByLabel(m.Cashier.change)).toHaveValue("110000");
    await expect(dialog.getByLabel(m.Cashier.rate, { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: m.Add.save, exact: true })).toBeEnabled();
    await expectNoHorizontalOverflow(page);
  });
  test(`${locale} same-currency tender/change preserves partial items and preview draft`, async ({ page }) => {
    const { dialog, m } = await startPurchase(page, locale);
    await dialog.getByLabel(m.Cashier.tender, { exact: true }).fill("20");
    await dialog.getByRole("button", { name: m.Cashier.addChange, exact: true }).click();
    await dialog.getByLabel(m.Cashier.change, { exact: true }).fill("7.50");
    await dialog.getByRole("button", { name: m.Breakdown.title, exact: true }).click();
    await dialog.getByRole("button", { name: m.Breakdown.addItem }).click();
    await dialog.getByLabel(m.Breakdown.description, { exact: true }).fill("Food · طعام");
    await dialog.getByLabel(m.Breakdown.amount, { exact: true }).fill("10");
    await expect(dialog.getByText("$2.50", { exact: true })).toBeVisible();
    const save = dialog.getByRole("button", { name: m.Add.save, exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog.getByText(m.Add.errorPreview)).toBeVisible();
    await expect(dialog.getByLabel(m.Cashier.tender)).toHaveValue("20");
    await expect(dialog.getByLabel(m.Breakdown.amount, { exact: true })).toHaveValue("10");
    await expectNoHorizontalOverflow(page);
  });
  test(`${locale} records USD plus LBP change without a rate and keeps rows independent`, async ({ page }) => {
    const { dialog, m } = await startPurchase(page, locale);
    await dialog.getByLabel(m.Cashier.tender).fill("20");
    await dialog.getByRole("button", { name: m.Cashier.addChange, exact: true }).click();
    await dialog.getByLabel(m.Cashier.change, { exact: true }).fill("5");
    await dialog.getByRole("button", { name: m.Cashier.addChange, exact: true }).click();
    await dialog.getByLabel(m.Cashier.currency).nth(1).selectOption("LBP");
    await dialog.getByLabel(m.Cashier.change, { exact: true }).nth(1).fill("223750");
    // Cross-currency change takes the actual amounts; no quote is asked for.
    await expect(dialog.getByLabel(m.Cashier.rate, { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("checkbox", { name: m.Cashier.confirmRate })).toHaveCount(0);
    await expect(dialog.getByText(m.Cashier.crossChangeHelp, { exact: true })).toBeVisible();
    await expect(dialog.getByText(m.Cashier.rateHelp, { exact: true })).toHaveCount(0);
    const save = dialog.getByRole("button", { name: m.Add.save, exact: true });
    await expect(save).toBeEnabled();
    await dialog.getByText(m.Cashier.crossChangeHelp, { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`cross-change-${locale}.png`), animations: "disabled" });
    // Change in another currency still needs cash paid above the purchase cost.
    await dialog.getByLabel(m.Cashier.tender).fill("12.50");
    await expect(save).toBeDisabled();
    await expect(dialog.getByText(m.Cashier.mismatch)).toBeVisible();
    await dialog.getByLabel(m.Cashier.tender).fill("20");
    await expect(save).toBeEnabled();
    await dialog.getByLabel(m.Cashier.currency).nth(1).selectOption("SYP");
    await expect(dialog.getByLabel(m.Cashier.change, { exact: true }).first()).toHaveValue("5");
    await expect(dialog.getByLabel(m.Cashier.change, { exact: true }).nth(1)).toHaveValue("");
    await dialog.getByLabel(m.Cashier.change, { exact: true }).nth(1).fill("32500");
    await expect(save).toBeEnabled();
    await expect(dialog.getByLabel(m.Cashier.change, { exact: true }).nth(1)).toHaveAttribute("dir", "ltr");
    await expectNoHorizontalOverflow(page);
  });
  test(`${locale} saved cashier detail and duplicate keep purchase cost separate`, async ({ page }) => {
    const m = locale === "ar" ? ar : en;
    await page.goto(`/${locale}/activity?q=Coffee`);
    await page.locator("main section li button").filter({ hasText: "Coffee" }).first().click();
    let dialog = page.getByRole("dialog");
    const summary = dialog.getByRole("region", { name: m.Cashier.summary });
    await expect(summary.getByText("$12.50", { exact: true })).toBeVisible();
    await expect(summary.getByText("$20.00", { exact: true })).toBeVisible();
    await expect(summary.getByText("$5.00", { exact: true })).toBeVisible();
    await expect(summary.getByText("LBP 223,750", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: m.Detail.duplicate }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(m.Cashier.tender)).toHaveValue("20");
    await expect(dialog.getByLabel(m.Cashier.change, { exact: true }).first()).toHaveValue("5");
    await expect(dialog.getByLabel(m.Cashier.change, { exact: true }).nth(1)).toHaveValue("223750");
    // A duplicate is new money: it records actual cash and drops the old quote.
    await expect(dialog.getByRole("checkbox", { name: m.Cashier.confirmRate })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: m.Add.save, exact: true })).toBeEnabled();
    await expectNoHorizontalOverflow(page);
  });
  test(`${locale} receiving-wallet filter includes the one purchase`, async ({ page }) => {
    await page.goto(`/${locale}/activity?walletId=00000000-0000-4000-8000-000000000003&q=Coffee`);
    await expect(page.locator("main section li button").filter({ hasText: "Coffee" })).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
  });
}
