import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support";

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

test("Got salary asks before adding a second time in the same month, then reports preview mode", async ({ page }) => {
  await page.goto("/en");
  const card = page.getByRole("region", { name: "Monthly salary" });
  await card.getByRole("button", { name: "Got salary" }).click();
  const again = card.getByRole("button", { name: "Add again" });
  if (await again.isVisible()) await again.click();
  // Preview mode cannot write, and says so instead of silently doing nothing.
  await expect(page.getByText(/preview without a database/i)).toBeVisible();
});

test("salary sheet: edit amount and pick the wallet it goes to", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("region", { name: "Monthly salary" }).getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Edit salary" })).toBeVisible();
  await expect(dialog.getByLabel("Salary amount")).toHaveValue("1800");
  await dialog.getByRole("radio", { name: /Cash · LBP/ }).click();
  await expect(dialog.getByRole("radio", { name: /Cash · LBP/ })).toBeChecked();
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
  const note = dialog.getByLabel("Note");
  await expect(note).toBeFocused();
  await note.fill("Gift for mum");
  await expect(dialog.getByText(/Gift for mum/).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
