import { expect, test } from "@playwright/test";
import en from "../src/messages/en.json";
import ar from "../src/messages/ar.json";
import { expectNoHorizontalOverflow } from "./support";

const messages = { en, ar };
for (const locale of ["en", "ar"] as const) {
  const c = messages[locale].Categories;
  for (const theme of ["light", "dark"] as const) {
    test(`${locale} ${theme}: category editor works at mobile and desktop widths`, async ({ page }, testInfo) => {
      await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
      for (const width of [320, 390, 430, 768, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(`/${locale}/settings/categories`);
        await expect(page.getByRole("heading", { name: c.title, exact: true })).toBeVisible();
        await page.getByRole("button", { name: c.add, exact: true }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByLabel(c.englishName)).toBeVisible();
        await dialog.getByLabel(c.arabicName).fill("اسم عربي طويل مع English مختلط");
        await dialog.getByRole("radio", { name: c.motif8, exact: true }).locator("..").click();
        await expect(dialog.getByRole("button", { name: c.save, exact: true })).toBeEnabled();
        await expectNoHorizontalOverflow(page);
        if (width === 390) await page.screenshot({ path: testInfo.outputPath(`categories-editor-${locale}-${theme}-390.png`) });
        await dialog.getByRole("button", { name: c.save, exact: true }).click();
        await expect(dialog.getByRole("alert")).toHaveText(c.errorPreview);
        await expect(dialog.getByLabel(c.arabicName)).toHaveValue("اسم عربي طويل مع English مختلط");
      }
    });
  }

  test(`${locale}: Settings links to categories and preview restoration keeps archives`, async ({ page }) => {
    await page.goto(`/${locale}/settings`);
    await page.getByRole("link", { name: messages[locale].Settings.categories, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/settings/categories`));
    await page.locator("summary").click();
    await page.getByRole("button", { name: c.restoreNamed.replace("{name}", locale === "en" ? "Old gifts" : "هدايا قديمة") }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(c.errorPreview);
    await expect(page.getByRole("button", { name: c.restoreNamed.replace("{name}", locale === "en" ? "Old gifts" : "هدايا قديمة") })).toBeVisible();
  });

  test(`${locale}: archived budgets retain history and offer clearing instead of Add`, async ({ page }) => {
    const b = messages[locale].Budgets;
    const name = locale === "en" ? "Old gifts" : "هدايا قديمة";
    await page.goto(`/${locale}/budgets?month=2020-02`);
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: b.addTo.replace("{name}", name) })).toHaveCount(0);
    await page.getByRole("button", { name: b.edit, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("textbox", { name: b.amountFor.replace("{name}", name) })).toHaveCount(0);
    await dialog.getByRole("button", { name: b.clearArchivedNamed.replace("{name}", name) }).click();
    await dialog.getByRole("button", { name: b.save, exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(b.errorPreview);
    await expectNoHorizontalOverflow(page);
  });
}
