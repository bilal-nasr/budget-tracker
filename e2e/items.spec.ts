import { expect, test } from "@playwright/test";

for (const locale of ["en", "ar"] as const) {
  const ar = locale === "ar";
  const title = ar ? "حاسبة المشتريات" : "Item calculator";
  test(`item calculator: total, selected total and buying ${locale}`, async ({ page }, testInfo) => {
    if (testInfo.project.name !== "desktop") await page.setViewportSize({ width: testInfo.project.name === "mobile-small" ? 320 : 390, height: 844 });
    await page.goto(`/${locale}/wallets`);
    await page.getByRole("link", { name: new RegExp(title) }).click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    // Preview data: three USD items to buy ($12.50 + $18.00 + $4.50), one already bought.
    const header = page.getByRole("banner");
    await expect(header).toContainText("$35.00");
    await page.getByRole("checkbox", { name: ar ? "تحديد Olive oil, 1 L" : "Select Olive oil, 1 L" }).check();
    await page.getByRole("checkbox", { name: ar ? "تحديد Notebook" : "Select Notebook" }).check();
    await expect(header).toContainText("$17.00");
    await page.screenshot({ path: testInfo.outputPath(`items-${locale}.png`), fullPage: true, animations: "disabled" });
    // Another currency keeps its own total and starts with nothing selected.
    await page.getByRole("tab", { name: "LBP" }).click();
    await expect(header).toContainText("LBP 90,000");
    await page.getByRole("tab", { name: "USD" }).click();
    await expect(page.getByRole("checkbox", { name: ar ? "تحديد Olive oil, 1 L" : "Select Olive oil, 1 L" })).not.toBeChecked();
    await page.getByRole("button", { name: ar ? "تسجيل شراء Olive oil, 1 L" : "Mark Olive oil, 1 L as bought" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("$12.50").first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`buy-${locale}.png`), animations: "disabled" });
    await dialog.getByRole("button", { name: ar ? "تسجيل الشراء" : "Record purchase", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(ar ? "المعاينة" : "preview");
    await dialog.getByRole("button", { name: ar ? "إغلاق" : "Close", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
