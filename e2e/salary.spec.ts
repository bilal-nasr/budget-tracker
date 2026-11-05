import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support";
import en from "../src/messages/en.json";
import ar from "../src/messages/ar.json";

// Demo data (no Supabase keys): salary is $1,800.00 into the demo Bank wallet.

test("salary card shows the fixed amount, wallet and a Got salary button", async ({ page }) => {
  await page.goto("/en");
  const card = page.getByRole("region", { name: "Monthly salary" });
  await expect(card).toBeVisible();
  await expect(card.getByText("$1,800.00")).toBeVisible();
  await expect(card.getByText(/Goes to/)).toContainText("Bank");
  await expect(card.getByRole("button", { name: "Got salary" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("Got salary opens a confirmation with the amount and wallet, Cancel adds nothing", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("region", { name: "Monthly salary" }).getByRole("button", { name: "Got salary" }).click();
  const dialog = page.getByRole("dialog", { name: en.Salary.confirmTitle });
  await expect(dialog).toContainText("$1,800.00");
  await expect(dialog).toContainText("Bank");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/preview without a database/i)).toHaveCount(0);
});

test("confirming calls the action (preview mode says it cannot save)", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("region", { name: "Monthly salary" }).getByRole("button", { name: "Got salary" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Add salary" }).click();
  await expect(page.getByText(/preview without a database/i)).toBeVisible();
});

test("arabic confirmation is RTL with an LTR amount and no overflow", async ({ page }) => {
  await page.goto("/ar");
  await page.getByRole("region", { name: "الراتب الشهري" }).getByRole("button", { name: "استلمت الراتب" }).click();
  const dialog = page.getByRole("dialog", { name: ar.Salary.confirmTitle });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("$1,800.00");
  expect(await dialog.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
  await expectNoHorizontalOverflow(page);
});

test("salary sheet: edit amount and pick the wallet it goes to", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("region", { name: "Monthly salary" }).getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Edit salary" })).toBeVisible();
  await expect(dialog.getByLabel("Salary amount")).toHaveValue("1800");
  await dialog.getByLabel(en.Salary.wallet, { exact: true }).selectOption({ label: "Pocket" });
  await dialog.getByLabel(en.Add.walletCurrency, { exact: true }).selectOption({ label: "LBP" });
  await expect(dialog.getByLabel(en.Add.walletCurrency, { exact: true })).toHaveValue("00000000-0000-4000-8000-000000000003");
  await dialog.getByLabel("Salary amount").fill("1x");
  await expect(dialog.getByText("Enter a valid amount.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save salary" })).toBeDisabled();
  await expectNoHorizontalOverflow(page);
});

test("arabic salary card is RTL with LTR amount", async ({ page }) => {
  await page.goto("/ar");
  const card = page.getByRole("region", { name: "الراتب الشهري" });
  await expect(card.getByRole("button", { name: "استلمت الراتب" })).toBeVisible();
  expect(await card.locator(".amount").first().evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
  await expectNoHorizontalOverflow(page);
});

test("Aa key opens the text field for a custom label and focuses it", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: "Add", exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Text", exact: true }).click();
  const name = dialog.getByLabel("Name");
  await expect(name).toBeFocused();
  await name.fill("Gift for mum");
  await expect(name).toHaveValue("Gift for mum");
  await expectNoHorizontalOverflow(page);
});
