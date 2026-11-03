import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support";

// These run against synthetic demo data (no Supabase keys), so writes report "preview".

const addButton = (page: Page) => page.getByRole("button", { name: "Add", exact: true }).filter({ visible: true });

test("wallets are grouped by currency with separate totals", async ({ page }) => {
  await page.goto("/en/wallets");
  await expect(page.getByRole("heading", { name: "USD", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "LBP", exact: true })).toBeVisible();
  // Never a combined total: exactly one "Total" per currency group.
  await expect(page.getByText(/^Total/)).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
});

test("home shows money per currency, recent activity and wallets", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByRole("heading", { name: "Money in your wallets" })).toBeAttached();
  await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wallets", exact: true })).toBeVisible();
  await expect(page.locator("main li").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("activity groups by day, searches, and filters by type", async ({ page }) => {
  await page.goto("/en/activity");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  const rows = page.locator("main section li");
  const total = await rows.count();
  expect(total).toBeGreaterThan(5);

  // Retry: on a cold start the first keystrokes can land before the page is interactive.
  await expect(async () => {
    const box = page.getByRole("searchbox", { name: "Search notes" });
    await box.fill("");
    await box.fill("taxi");
    await expect(page).toHaveURL(/q=taxi/, { timeout: 2500 });
  }).toPass({ timeout: 20_000 });
  await expect(rows.first()).toContainText(/taxi/i);
  for (const row of await rows.all()) await expect(row).toContainText(/taxi/i);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/q=/);
  await page.getByRole("radio", { name: "Income" }).click();
  await expect(page).toHaveURL(/kind=income/);
  for (const row of await rows.all()) await expect(row.getByText(/^\+/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("activity loads more with the button (keyset pages)", async ({ page }) => {
  await page.goto("/en/activity");
  const rows = page.locator("main section li");
  const first = await rows.count();
  const more = page.getByRole("button", { name: "Load more" });
  if (await more.isVisible()) {
    await more.click();
    await expect.poll(() => rows.count()).toBeGreaterThan(first);
  } else {
    // The sentinel may already have loaded the next page.
    await expect(page.getByText("That's everything.")).toBeVisible();
  }
});

test("tapping a row opens details with edit, duplicate and delete", async ({ page }) => {
  await page.goto("/en/activity");
  await page.locator("main section li button").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Details" })).toBeVisible();
  for (const name of ["Edit", "Duplicate", "Delete"]) await expect(dialog.getByRole("button", { name })).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();
  // Preview mode cannot write, and says so instead of failing silently.
  await expect(page.getByText(/preview without a database/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("add sheet: type an amount, pick a category, Save stays reachable", async ({ page }) => {
  await page.goto("/en");
  await addButton(page).click();
  const dialog = page.getByRole("dialog");
  const save = dialog.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();

  for (const key of ["5", "4", ".", "2"]) await dialog.getByRole("button", { name: key, exact: true }).click();
  await expect(dialog.getByLabel("Amount")).toContainText("54.2");
  await dialog.getByRole("radio", { name: "Groceries" }).click();
  await expect(save).toBeEnabled();

  // Save is inside the viewport even on short screens.
  const box = await save.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);

  await save.click();
  await expect(dialog.getByText(/preview without a database/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("add sheet: switching to LBP drops decimals and shows a 000 key", async ({ page }) => {
  await page.goto("/en");
  await addButton(page).click();
  const dialog = page.getByRole("dialog");
  for (const key of ["1", ".", "5"]) await dialog.getByRole("button", { name: key, exact: true }).click();
  await dialog.getByRole("button", { name: /USD/ }).click();
  await dialog.getByRole("radio", { name: /LBP/ }).click();
  await expect(dialog.getByLabel("Amount")).not.toContainText(".");
  await expect(dialog.getByRole("button", { name: "000", exact: true })).toBeVisible();
});

test("arabic activity: RTL, amounts stay LTR and aligned", async ({ page }) => {
  await page.goto("/ar/activity");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const amount = page.locator("main li .amount").first();
  await expect(amount).toBeVisible();
  expect(await amount.evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
  await expectNoHorizontalOverflow(page);
});

test("archived wallets are listed separately and can be restored", async ({ page }) => {
  await page.goto("/en/wallets");
  const toggle = page.getByRole("button", { name: "Archived wallets (1)" });
  await expect(toggle).toBeVisible();
  await expect(page.getByText("Old savings")).toHaveCount(0);
  await toggle.click();
  await page.getByRole("button", { name: /Old savings/ }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Restore wallet" })).toBeVisible();
  // Archived wallets never count toward totals or the Add wallet picker.
  await expect(page.getByRole("dialog").getByRole("button", { name: "Archive wallet" })).toHaveCount(0);
});
