import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support";

// Demo data (no Supabase keys): Rent share is already paid; Internet and Generator are not.

test("fixed expenses card lists each item with its amount, wallet and a Paid button", async ({ page }) => {
  await page.goto("/en");
  const card = page.getByRole("region", { name: "Fixed expenses" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Edit Internet" })).toContainText("$30.00");
  await expect(card.getByRole("button", { name: "Mark Internet as paid" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Mark Generator as paid" })).toBeVisible();
  // Already paid this month: shows a check and no Paid button.
  await expect(card.getByText(/^Paid /)).toBeVisible();
  await expect(card.getByRole("button", { name: "Mark Rent share as paid" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("left to pay adds up unpaid items per currency, never mixed", async ({ page }) => {
  await page.goto("/en");
  const card = page.getByRole("region", { name: "Fixed expenses" });
  await expect(card.getByText(/Left to pay/)).toContainText("$75.00");
});

test("pressing Paid reports preview mode instead of silently doing nothing", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: "Mark Internet as paid" }).click();
  await expect(page.getByText(/preview without a database/i)).toBeVisible();
});

test("add fixed expense sheet has name, wallet, amount, category and optional due day", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("region", { name: "Fixed expenses" }).getByRole("button", { name: "Add fixed expense" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "New fixed expense" })).toBeVisible();
  const save = dialog.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  await dialog.getByLabel("Name").fill("Gym");
  await dialog.getByLabel("Amount").fill("20");
  await dialog.getByRole("radio", { name: "Fun" }).click();
  await expect(save).toBeEnabled();
  await dialog.getByLabel("Due day (optional)").fill("45");
  await expect(dialog.getByText("Enter a day from 1 to 31.")).toBeVisible();
  await expect(save).toBeDisabled();
  await dialog.getByLabel("Due day (optional)").fill("5");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog.getByText(/preview without a database/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("editing an item offers delete with a confirmation", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: "Edit Generator" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Name")).toHaveValue("Generator");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog.getByText(/Payments you already recorded stay/)).toBeVisible();
});

test("arabic fixed expenses: RTL card with a Paid button and LTR amounts", async ({ page }) => {
  await page.goto("/ar");
  const card = page.getByRole("region", { name: "المصاريف الثابتة" });
  await expect(card.getByRole("button", { name: /^سجّل .* كمدفوع$/ }).first()).toBeVisible();
  expect(await card.locator(".amount").first().evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
  await expectNoHorizontalOverflow(page);
});
