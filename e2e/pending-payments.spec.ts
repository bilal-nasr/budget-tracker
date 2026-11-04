import { expect, test } from "@playwright/test";

for (const locale of ["en", "ar"] as const) {
  const ar = locale === "ar";
  test(`pending payments and partial receipt form ${locale}`, async ({ page }, testInfo) => {
    if (testInfo.project.name !== "desktop") await page.setViewportSize({ width: testInfo.project.name === "mobile-small" ? 320 : 390, height: 844 });
    await page.goto(`/${locale}/wallets`);
    await page.getByRole("link", { name: ar ? "دفعات منتظرة" : "Pending payments", exact: true }).click();
    await expect(page.getByRole("heading", { name: ar ? "دفعات منتظرة" : "Pending payments", exact: true })).toBeVisible();
    await expect(page.getByText("Website design", { exact: true })).toBeVisible();
    // Receipt history loads on first open, then shows its count.
    const history = page.locator("details").filter({ has: page.getByText(ar ? "سجل الدفعات المستلمة" : "Receipt history") });
    await history.locator("summary").click();
    await expect(history.getByText("$200.00", { exact: true })).toBeVisible();
    await expect(history.locator("summary")).toHaveText(ar ? "سجل الدفعات المستلمة (1)" : "Receipt history (1)");
    await page.screenshot({ path: testInfo.outputPath(`pending-${locale}.png`), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: ar ? "تسجيل دفعة مستلمة" : "Record receipt", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const amount = dialog.getByLabel(ar ? "المبلغ المستلم" : "Amount received", { exact: true });
    await amount.fill("100");
    await expect(dialog.getByText("$300.00", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: ar ? "حفظ الدفعة" : "Save receipt", exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`receipt-${locale}.png`), animations: "disabled" });
    await amount.fill("401");
    await expect(dialog.getByRole("button", { name: ar ? "حفظ الدفعة" : "Save receipt", exact: true })).toBeDisabled();
    await amount.fill("100");
    await dialog.getByRole("button", { name: ar ? "حفظ الدفعة" : "Save receipt", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(ar ? "العرض التجريبي" : "preview");
    await dialog.getByRole("button", { name: ar ? "إغلاق" : "Close", exact: true }).click();
    await page.getByRole("button", { name: ar ? "إضافة دفعة منتظرة" : "Add pending payment", exact: true }).click();
    const create = page.getByRole("dialog");
    await create.getByLabel(ar ? "العميل" : "Client", { exact: true }).fill("Test client");
    await create.getByLabel(ar ? "المشروع أو العمل" : "Project or work", { exact: true }).fill("Test project");
    await create.getByLabel(ar ? "إجمالي المستحق (USD)" : "Total owed (USD)", { exact: true }).fill("600");
    await expect(create.getByRole("button", { name: ar ? "حفظ الدفعة المنتظرة" : "Save payment", exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`create-${locale}.png`), animations: "disabled" });
    await create.getByRole("button", { name: ar ? "حفظ الدفعة المنتظرة" : "Save payment", exact: true }).click();
    await expect(create.getByRole("alert")).toContainText(ar ? "العرض التجريبي" : "preview");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
