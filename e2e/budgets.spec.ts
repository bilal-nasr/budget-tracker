import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support";

// Demo data (no Supabase keys), USD this month: Groceries $340 of $300 (over), Eating out $95 of $80 (over),
// Transport $42 of $120, Health $0 of $60, Fun $15 with no budget. Total limit $560, spent $492.
// LBP: Transport 700,000 of 1,000,000. Limits start two months back; earlier months are empty.

test("budgets show spent, left and over-budget with an icon and text", async ({ page }) => {
  await page.goto("/en/budgets");
  const list = page.getByRole("list", { name: "Budgets" });
  await expect(list.getByRole("listitem").filter({ hasText: "Groceries" })).toContainText(/Over by\W+\$40\.00/);
  await expect(list.getByRole("listitem").filter({ hasText: "Transport" })).toContainText(/\$78\.00\W+left/);
  await expect(list.getByRole("listitem").filter({ hasText: "Groceries" }).getByRole("meter")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("2 categories are over budget");
  await expect(page.getByRole("heading", { name: "Not budgeted" })).toBeVisible();
  await expect(page.getByText(/\$15\.00\W+spent/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("summary band shows spent against the total limit", async ({ page }) => {
  await page.goto("/en/budgets");
  await expect(page.locator("header")).toContainText("$492.00");
  await expect(page.locator("header")).toContainText(/of\W+\$560\.00\W+·\W+\$68\.00\W+left/);
});

test("currency switch shows LBP budgets only", async ({ page }) => {
  await page.goto("/en/budgets");
  await page.locator("label").filter({ hasText: /^LBP$/ }).click();
  await expect(page).toHaveURL(/currency=LBP/);
  const list = page.getByRole("list", { name: "Budgets" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("LBP 700,000");
  await expect(list).not.toContainText("$");
});

test("tapping a row opens Activity filtered to its category and month", async ({ page }) => {
  await page.goto("/en/budgets");
  await page.getByRole("link", { name: "See Groceries in Activity" }).click();
  await expect(page).toHaveURL(/\/en\/activity\?.*categoryId=/);
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-01/);
});

test("the plus on a row opens Add with that category chosen", async ({ page }) => {
  await page.goto("/en/budgets");
  await page.getByRole("button", { name: "Add expense to Transport" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Category" })).toContainText("Transport");
});

test("a month before any budget shows the empty state", async ({ page }) => {
  await page.goto("/en/budgets?month=2020-01");
  await expect(page.getByRole("heading", { name: "No budgets yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Set budgets" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("edit sheet shows limits, a running total and salary after fixed", async ({ page }) => {
  await page.goto("/en/budgets");
  await page.getByRole("button", { name: "Edit budgets" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit budgets" });
  await expect(dialog.getByLabel("Monthly limit for Groceries")).toHaveValue("300");
  await expect(dialog.getByLabel("Monthly limit for Fun")).toHaveValue("");
  await expect(dialog).toContainText(/Total budgets\W*\$560\.00/);
  await dialog.getByLabel("Monthly limit for Fun").fill("40");
  await expect(dialog).toContainText(/Total budgets\W*\$600\.00/);
  await dialog.getByLabel("Monthly limit for Fun").fill("4x");
  await expect(dialog.getByText("Enter a valid amount.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save budgets" })).toBeDisabled();
  await dialog.getByLabel("Monthly limit for Fun").fill("40");
  await dialog.getByRole("button", { name: "Save budgets" }).click();
  await expect(dialog.getByText(/preview without a database/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("Home shows what is left to spend and links over-budget categories to Budgets", async ({ page }) => {
  await page.goto("/en");
  const header = page.locator("header");
  await expect(header).toContainText(/Left to spend this month\W+\$68\.00/);
  await expect(header).toContainText(/Left to spend this month\W+LBP 300,000/);
  await header.getByRole("link", { name: "2 categories are over budget" }).click();
  await expect(page).toHaveURL(/\/en\/budgets/);
});

test("arabic budgets are RTL with LTR amounts and no overflow", async ({ page }) => {
  await page.goto("/ar/budgets");
  await expect(page.getByRole("list", { name: "الميزانيات" }).getByRole("listitem").first()).toContainText("بقالة");
  expect(await page.locator(".amount").first().evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "تعديل الميزانيات" }).click();
  await expectNoHorizontalOverflow(page);
});
