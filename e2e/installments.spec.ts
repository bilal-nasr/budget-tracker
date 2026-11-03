import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support";

// Demo data (no Supabase keys): Laptop $1,200 total, $100 monthly, 3 payments of $100 from Bank
// (so $900 left); Fridge $600 total, paid off. Wallets: Cash USD, Bank USD, Cash LBP, Card USD.

const segment = (scope: Locator | Page, name: string) => scope.locator("label").filter({ hasText: new RegExp(`^${name}$`) });
const card = (page: Page) => page.getByRole("region", { name: "Fixed expenses" });

test("installment row shows what is left and a Pay button; paid-off ones are collapsed", async ({ page }) => {
  await page.goto("/en");
  const row = card(page).getByRole("list", { name: "Installments" }).getByRole("listitem").filter({ hasText: "Laptop" });
  await expect(row).toContainText(/\$900\.00\W+left of\W+\$1,200\.00/);
  await expect(row.getByRole("button", { name: "Pay Laptop" })).toBeVisible();
  await expect(row.getByRole("meter")).toHaveAttribute("aria-valuenow", "25");
  await expect(card(page).getByText("Fridge")).toHaveCount(0);
  await card(page).getByRole("button", { name: "Paid off (1)" }).click();
  await expect(card(page).getByText("Fridge")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("Pay sheet pre-fills the monthly amount, offers only same-currency wallets, blocks overpaying", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: "Pay Laptop" }).click();
  const dialog = page.getByRole("dialog", { name: "Pay Laptop" });
  await expect(dialog.getByLabel("Amount")).toHaveValue("100");
  await expect(dialog.getByRole("radio", { name: /Bank · USD/ })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: /LBP/ })).toHaveCount(0);
  await expect(dialog).toContainText(/Left after this payment:\W*\$800\.00/);
  await dialog.getByLabel("Amount").fill("901");
  await expect(dialog.getByRole("button", { name: "Record payment" })).toBeDisabled();
  await expect(dialog.getByText(/more than what is left/)).toBeVisible();
  await dialog.getByLabel("Amount").fill("100");
  await dialog.getByRole("radio", { name: /Cash · USD/ }).click();
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText(/preview without a database/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("edit sheet lists the payment history with date, wallet and amount", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: "Edit Laptop" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit installment" });
  const history = dialog.getByRole("region", { name: "Payment history" });
  await expect(history.getByRole("listitem")).toHaveCount(3);
  await expect(history.getByRole("listitem").first()).toContainText("Bank");
  await expect(history.getByRole("listitem").first()).toContainText("$100.00");
  await expectNoHorizontalOverflow(page);
});

test("Add fixed expense can switch to Installment, which needs name, total, wallet and category", async ({ page }) => {
  await page.goto("/en");
  await card(page).getByRole("button", { name: "Add fixed expense" }).click();
  const dialog = page.getByRole("dialog");
  await segment(dialog, "Installment").click();
  const save = dialog.getByRole("button", { name: "Save", exact: true });
  await expect(dialog.getByLabel("Total to pay")).toBeVisible();
  await expect(dialog.getByLabel("Monthly payment (optional)")).toBeVisible();
  await expect(save).toBeDisabled();
  await dialog.getByLabel("Name").fill("Phone");
  await dialog.getByLabel("Total to pay").fill("600");
  await dialog.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: "Shopping" }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog.getByText(/preview without a database/i)).toBeVisible();
});

test("deleting an installment asks first and says its payments stay", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("button", { name: "Edit Laptop" }).click();
  await page.getByRole("dialog", { name: "Edit installment" }).getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete Laptop?" });
  await expect(confirm).toContainText("Its payments stay in Activity.");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
});

test("arabic installment row is RTL with LTR amounts and no overflow", async ({ page }) => {
  await page.goto("/ar");
  const row = card(page).page().getByRole("region", { name: "المصاريف الثابتة" });
  await expect(row.getByRole("button", { name: "دفع Laptop" })).toBeVisible();
  await row.getByRole("button", { name: "دفع Laptop" }).click();
  const dialog = page.getByRole("dialog", { name: "دفع Laptop" });
  await expect(dialog.getByLabel("المبلغ")).toHaveValue("100");
  await expectNoHorizontalOverflow(page);
});
