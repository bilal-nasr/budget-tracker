import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support";

// These run against synthetic demo data (no Supabase keys), so writes report "preview".

const addButton = (page: Page) => page.getByRole("button", { name: "Add", exact: true }).filter({ visible: true });

test("global Currency view shows the same wallets without combined totals", async ({ page }) => {
  await page.goto("/en/wallets");
  const currency = page.getByRole("combobox", { name: "Display currency", exact: true });
  const wallets = page.getByRole("list", { name: "Wallets", exact: true });
  const names = await wallets.getByRole("button", { name: /^Edit / }).allTextContents();
  expect(names.length).toBeGreaterThan(0);
  for (const code of ["USD", "LBP", "SYP"]) {
    await currency.selectOption(code);
    await expect(wallets.getByRole("listitem")).toHaveCount(names.length);
    await expect(wallets).not.toContainText("Balance unavailable");
    await expect(page.getByText(/^Total/)).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  }
});

test("home shows money per currency, recent activity and wallets", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByRole("heading", { name: "Money in your wallets" })).toBeAttached();
  await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wallets", exact: true })).toBeVisible();
  await expect(page.locator("main li").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

for (const locale of ["en", "ar"] as const) {
  const ar = locale === "ar";
  test(`activity filter sheet loads on first open and applies a wallet ${locale}`, async ({ page }, testInfo) => {
    if (testInfo.project.name !== "desktop") await page.setViewportSize({ width: testInfo.project.name === "mobile-small" ? 320 : 390, height: 844 });
    await page.goto(`/${locale}/activity`);
    const open = page.getByRole("button", { name: ar ? "التصفية" : "Filters", exact: true });
    await open.click();
    const sheet = page.getByRole("dialog", { name: ar ? "التصفية" : "Filters" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("radio", { name: ar ? "كل المحافظ" : "All wallets" })).toHaveAttribute("aria-checked", "true");
    await page.screenshot({ path: testInfo.outputPath(`activity-filters-${locale}.png`), animations: "disabled" });
    await sheet.getByRole("radio", { name: "Bank · USD", exact: true }).click();
    await sheet.getByRole("button", { name: ar ? "تطبيق" : "Apply", exact: true }).click();
    await expect(page).toHaveURL(/balanceId=/);
    await expect(sheet).toBeHidden();
    // Reopening re-syncs from the URL.
    await open.click();
    await expect(page.getByRole("dialog").getByRole("radio", { name: "Bank · USD", exact: true })).toHaveAttribute("aria-checked", "true");
    await expectNoHorizontalOverflow(page);
  });
}

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
  await dialog.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: "Groceries" }).click();
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
  await dialog.getByRole("combobox", { name: "Wallet currency", exact: true }).selectOption({ label: "LBP" });
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

test("deleted wallets stay out of ordinary lists and the Add picker", async ({ page }) => {
  await page.goto("/en/wallets");
  await expect(page.getByRole("button", { name: /Old savings/ })).toHaveCount(0);
  await addButton(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Wallet", exact: true }).getByRole("option", { name: /Old savings/ })).toHaveCount(0);
});

test("wallet deletion inspection blocks preview confirmation", async ({ page }) => {
  await page.goto("/en/wallets");
  await page.getByRole("button", { name: "Edit Syrian bank", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete wallet permanently", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText(/preview/i);
  await expect(dialog.getByRole("button", { name: "Settle and delete permanently", exact: true })).toBeDisabled();
  await expectNoHorizontalOverflow(page);
});

test("active wallets expose explicit deletion and editable defaults", async ({ page }) => {
  await page.goto("/en/wallets");
  await page.getByRole("button", { name: "Edit Pocket", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Default currency", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Delete wallet permanently", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Archive wallet", exact: true })).toHaveCount(0);
});

test("category is a dropdown and Name is visible in the Add sheet", async ({ page }) => {
  await page.goto("/en");
  await addButton(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", { name: "Groceries" })).toHaveCount(0);
  await expect(dialog.getByLabel("Name")).toBeVisible();
  await dialog.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: "Health" }).click();
  await expect(dialog.getByRole("combobox", { name: "Category" })).toContainText("Health");
  await dialog.getByRole("button", { name: "Text", exact: true }).click();
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await expectNoHorizontalOverflow(page);
});

test("arabic category dropdown lists Arabic names with no overflow", async ({ page }) => {
  await page.goto("/ar");
  await page.getByRole("button", { name: "إضافة", exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "الفئة" }).click();
  await expect(page.getByRole("option", { name: "بقالة" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
