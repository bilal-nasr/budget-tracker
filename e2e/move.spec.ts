import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support";

// Demo data (no Supabase keys): Cash USD, Bank USD, Cash LBP, Card USD, plus an archived wallet.

// The segmented control's radios are visually hidden; people click the visible label.
const segment = (scope: Locator | Page, name: string) => scope.locator("label").filter({ hasText: new RegExp(`^${name}$`) });

const add = (page: Page) => page.getByRole("button", { name: "Add", exact: true }).filter({ visible: true });

test("Move tab: same currency needs only a destination and an amount", async ({ page }) => {
  await page.goto("/en");
  await add(page).click();
  const dialog = page.getByRole("dialog");
  await segment(dialog, "Move").click();
  // No category grid, and no "received" field for a same-currency move.
  await expect(dialog.getByRole("radiogroup", { name: "Category" })).toHaveCount(0);
  await expect(dialog.getByLabel(/You received/)).toHaveCount(0);
  const save = dialog.getByRole("button", { name: "Move money" });
  await expect(save).toBeDisabled();
  for (const key of ["5", "0"]) await dialog.getByRole("button", { name: key, exact: true }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog.getByText(/preview without a database/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("Move tab: moving into another currency asks for exactly what arrived", async ({ page }) => {
  await page.goto("/en");
  await add(page).click();
  const dialog = page.getByRole("dialog");
  await segment(dialog, "Move").click();
  for (const key of ["2", "0"]) await dialog.getByRole("button", { name: key, exact: true }).click();
  await dialog.getByRole("radiogroup", { name: "To" }).getByRole("radio", { name: "Cash · LBP" }).click();
  const received = dialog.getByLabel("You received (LBP)");
  await expect(received).toBeVisible();
  const save = dialog.getByRole("button", { name: "Move money" });
  // The saved rate fills the amount; with no rate there is nothing to move until it is typed.
  await dialog.getByLabel("Exchange rate").fill("");
  await expect(received).toHaveValue("");
  await expect(save).toBeDisabled();
  await received.fill("1800000");
  await expect(save).toBeEnabled();
  await received.fill("1x");
  await expect(dialog.getByText("Enter a valid amount.")).toBeVisible();
  await expect(save).toBeDisabled();
});

test("Add money on a wallet starts as new money and can switch to taking it from another wallet", async ({ page }) => {
  await page.goto("/en/wallets");
  await page.getByRole("button", { name: /^Bank/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Add money" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", { name: "Income", exact: true })).toBeChecked();
  await expect(dialog.getByText(/Adding new money to Bank/)).toBeVisible();
  await segment(dialog, "Move").click();
  await expect(dialog.getByText(/Adding money to Bank/)).toBeVisible();
  // Bank is the destination (checked), and the source is another wallet, so it is not offered as a destination.
  const to = dialog.getByRole("radiogroup", { name: "To" });
  await expect(to.getByRole("radio", { name: "Bank · USD" })).toHaveAttribute("aria-checked", "true");
  await expect(to.getByRole("radio", { name: "Cash · USD" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("new wallet: starting balance can be new money or taken from another wallet", async ({ page }) => {
  await page.goto("/en/wallets");
  await page.getByRole("button", { name: "Add wallet" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Savings");
  await expect(dialog.getByText("Where does this money come from?")).toHaveCount(0);
  await dialog.getByLabel("Amount").fill("100");
  await expect(dialog.getByText("Where does this money come from?")).toBeVisible();
  await segment(dialog, "From another wallet").click();
  await dialog.getByRole("radiogroup", { name: "Take it from" }).getByRole("radio", { name: "Cash · LBP" }).click();
  const taken = dialog.getByLabel("Amount taken from it (LBP)");
  await expect(taken).toBeVisible();
  const create = dialog.getByRole("button", { name: "Create wallet" });
  await expect(create).toBeDisabled();
  await taken.fill("9000000");
  await expect(create).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});

test("activity shows moves with where they went, and the Moves filter lists only moves", async ({ page }) => {
  await page.goto("/en/activity");
  await page.getByRole("radio", { name: "Moves" }).click();
  await expect(page).toHaveURL(/kind=transfer/);
  const rows = page.locator("main section li");
  await expect(rows.first()).toContainText("Move");
  for (const row of await rows.all()) await expect(row).toContainText("Move");
  // The exchange shows both sides: what left, and what arrived in the other currency.
  await expect(page.locator("main section li", { hasText: "LBP 1,800,000" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("a move's details offer delete only (no edit or duplicate)", async ({ page }) => {
  await page.goto("/en/activity?kind=transfer");
  await page.locator("main section li button").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Money moved between wallets")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Duplicate" })).toHaveCount(0);
});

test("arabic move form is RTL and keeps amounts LTR", async ({ page }) => {
  await page.goto("/ar");
  await page.getByRole("button", { name: "إضافة", exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog");
  await segment(dialog, "نقل").click();
  await expect(dialog.getByRole("button", { name: "انقل المال" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("exchange asks for 1$ = rate, converts, and the result can be edited", async ({ page }) => {
  await page.goto("/en");
  await add(page).click();
  const dialog = page.getByRole("dialog");
  await segment(dialog, "Move").click();
  for (const key of ["1", "0", "0"]) await dialog.getByRole("button", { name: key, exact: true }).click();
  await dialog.getByRole("radiogroup", { name: "To" }).getByRole("radio", { name: "Cash · LBP" }).click();
  const rate = dialog.getByLabel("Exchange rate");
  const received = dialog.getByLabel("You received (LBP)");
  await expect(rate).toHaveValue("89500");
  await expect(received).toHaveValue("8950000");
  await rate.fill("90000");
  await expect(received).toHaveValue("9000000");
  await received.fill("8900000");
  await rate.fill("91000");
  await expect(received).toHaveValue("8900000");
  await dialog.getByRole("button", { name: "Use rate" }).click();
  await expect(received).toHaveValue("9100000");
  await rate.fill("89x");
  await expect(dialog.getByText("Enter a whole number, e.g. 89500.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("same-currency move shows no rate", async ({ page }) => {
  await page.goto("/en");
  await add(page).click();
  const dialog = page.getByRole("dialog");
  await segment(dialog, "Move").click();
  await expect(dialog.getByLabel("Exchange rate")).toHaveCount(0);
});

test("arabic exchange rate row reads left to right with no overflow", async ({ page }) => {
  await page.goto("/ar");
  await page.getByRole("button", { name: "إضافة", exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("label").filter({ hasText: /^نقل$/ }).click();
  await dialog.getByRole("button", { name: "5", exact: true }).click();
  await dialog.getByRole("radiogroup").filter({ hasText: "LBP" }).getByRole("radio", { name: /LBP/ }).first().click();
  const rate = dialog.getByLabel("سعر الصرف");
  await expect(rate).toHaveValue("89500");
  await expectNoHorizontalOverflow(page);
});
