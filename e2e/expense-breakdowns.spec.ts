import { expect, test } from "@playwright/test";
import en from "../src/messages/en.json";
import ar from "../src/messages/ar.json";
import { expectNoHorizontalOverflow } from "./support";

// Demo-only cases. Parent runs these after returning the browser lane to demo;
// preview writes must fail honestly and cannot establish database persistence.
for (const locale of ["en", "ar"] as const) {
  const messages = locale === "ar" ? ar : en;
  test(`${locale} optional partial breakdown preserves parent name and preview draft`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await page.getByRole("button", { name: messages.Nav.add, exact: true }).filter({ visible: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(messages.Breakdown.description)).toHaveCount(0);
    for (const key of ["5", "0"]) await dialog.getByRole("button", { name: key, exact: true }).click();
    await dialog.getByLabel(messages.Add.name, { exact: true }).fill("Sister · أختي");
    await dialog.getByRole("combobox", { name: messages.Add.category }).click();
    await page.getByRole("option", { name: locale === "ar" ? "أخرى" : "Other", exact: true }).click();
    await dialog.getByRole("button", { name: messages.Breakdown.title, exact: true }).click();
    await dialog.getByRole("button", { name: messages.Breakdown.addItem }).click();
    await dialog.getByLabel(messages.Breakdown.description, { exact: true }).fill("Phone credits · رصيد الهاتف");
    await dialog.getByLabel(messages.Breakdown.amount, { exact: true }).fill("٢٠٫٠٠");
    await expect(dialog.getByText("$30.00", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel(messages.Add.name, { exact: true })).toHaveValue("Sister · أختي");
    const save = dialog.getByRole("button", { name: messages.Add.save, exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog.getByText(messages.Add.errorPreview)).toBeVisible();
    await expect(dialog.getByLabel(messages.Breakdown.description, { exact: true })).toHaveValue("Phone credits · رصيد الهاتف");
    await expectNoHorizontalOverflow(page);
  });

  test(`${locale} saved demo parent opens all lines for edit and duplicate`, async ({ page }) => {
    await page.goto(`/${locale}/activity`);
    await page.locator("main section li button").filter({ hasText: "Supermarket" }).first().click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Phone credits", { exact: true })).toBeVisible();
    await expect(dialog.getByText("For sister", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: messages.Detail.edit, exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(messages.Add.name, { exact: true })).toHaveValue("Supermarket");
    await expect(dialog.getByLabel(messages.Breakdown.description, { exact: true })).toHaveCount(2);
    await dialog.getByLabel(messages.Breakdown.amount, { exact: true }).first().fill("54.21");
    await expect(dialog.getByRole("button", { name: messages.Add.saveChanges })).toBeDisabled();
    await expect(dialog.getByText(messages.Breakdown.exceedsTotal)).toBeVisible();
    await dialog.getByRole("button", { name: messages.Nav.close, exact: true }).click();
    await page.locator("main section li button").filter({ hasText: "Supermarket" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: messages.Detail.duplicate, exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(messages.Add.name, { exact: true })).toHaveValue("Supermarket");
    await expect(dialog.getByLabel(messages.Breakdown.description, { exact: true })).toHaveCount(2);
    await expect(dialog.getByLabel(messages.Breakdown.amount, { exact: true }).first()).toHaveValue("20");
    await expect(dialog.getByRole("button", { name: messages.Add.save, exact: true })).toBeEnabled();
    await expectNoHorizontalOverflow(page);
  });
}
