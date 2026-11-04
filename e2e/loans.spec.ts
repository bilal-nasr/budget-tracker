import { expect, test, type Locator, type Page } from "@playwright/test";
import en from "../src/messages/en.json";
import ar from "../src/messages/ar.json";
import { expectNoHorizontalOverflow } from "./support";

// This suite uses the existing read-only demo runner. Preview failures are
// asserted explicitly; persistent repayment/void/replay behavior belongs to SQL
// and the separately provisioned authenticated local concurrency checks.
test.use({ viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }) => {
  // The development indicator overlaps short footer links at phone widths.
  // Isolate that developer-only overlay, never force clicks through application UI.
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { pointer-events: none !important; }";
    document.head.appendChild(style);
  }, { once: true }));
});
const catalogs = { en, ar };
async function chooseCategory(page: Page, dialog: Locator, label: string) {
  await dialog.getByRole("combobox", { name: label }).click();
  await page.getByRole("option").first().click();
}

for (const locale of ["en", "ar"] as const) {
  const messages = catalogs[locale];
  const t = messages.Loans;
  test(`${locale}: Wallets links to separate loan totals including SYP`, async ({ page }) => {
    await page.goto(`/${locale}/wallets`);
    await page.getByRole("link", { name: t.title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/loans`));
    await expect(page.getByRole("heading", { name: t.title, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "USD", exact: true })).toContainText(t.owed);
    await expect(page.getByRole("region", { name: "USD", exact: true })).toContainText(t.receivable);
    await expect(page.getByRole("region", { name: "SYP", exact: true })).toContainText("SYP 1,341");
    await expectNoHorizontalOverflow(page);
  });

  for (const direction of ["borrowed", "lent"] as const) test(`${locale}: ${direction} previews a one-time fee and an explicit cash direction`, async ({ page }) => {
    await page.goto(`/${locale}/loans`);
    await page.getByRole("button", { name: t.add, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: t.add, exact: true });
    await dialog.getByRole("radio", { name: t[direction], exact: true }).check();
    await dialog.getByLabel(t.name, { exact: true }).fill("Synthetic loan draft");
    await dialog.getByLabel(t.principal, { exact: true }).fill(locale === "ar" ? "١٠٠٠" : "1000");
    await dialog.getByLabel(t.percent, { exact: true }).fill(locale === "ar" ? "٧٫٢٥" : "7.25");
    await expect(dialog.getByText("$72.50", { exact: true })).toBeVisible();
    await expect(dialog.getByText("$1,072.50", { exact: true })).toBeVisible();
    await chooseCategory(page, dialog, t.category);
    const save = dialog.getByRole("button", { name: t.save, exact: true });
    await expect(save).toBeDisabled();
    await dialog.getByRole("radio", { name: t.new, exact: true }).check();
    await expect(dialog.getByText(direction === "borrowed" ? t.cashIn : t.cashOut, { exact: false })).toBeVisible();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog.getByRole("alert")).toContainText(t.errorPreview);
    await expectNoHorizontalOverflow(page);
  });

  test(`${locale}: existing mode records no new cash and validates each opening component`, async ({ page }) => {
    await page.goto(`/${locale}/loans`);
    await page.getByRole("button", { name: t.add, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: t.add, exact: true });
    await dialog.getByLabel(t.name).fill("Existing synthetic debt");
    await dialog.getByLabel(t.principal, { exact: true }).fill("1000");
    await dialog.getByLabel(t.percent).fill("7.25");
    await chooseCategory(page, dialog, t.category);
    await dialog.getByRole("radio", { name: t.existing, exact: true }).check();
    await expect(dialog.getByText(t.existingHelp, { exact: true })).toBeVisible();
    const save = dialog.getByRole("button", { name: t.save, exact: true });
    await dialog.getByLabel(t.principalBefore).fill("1001");
    await expect(save).toBeDisabled();
    await dialog.getByLabel(t.principalBefore).fill("400");
    await dialog.getByLabel(t.feeBefore).fill("72.51");
    await expect(save).toBeDisabled();
    await dialog.getByLabel(t.feeBefore).fill("10");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog.getByRole("alert")).toContainText(t.errorPreview);
  });

  test(`${locale}: payment previews principal first, rejects overpayment and isolates currency`, async ({ page }) => {
    await page.goto(`/${locale}/loans?loanId=00000000-0000-4000-8000-000000007001`);
    await page.getByRole("dialog", { name: "Workshop loan", exact: true }).getByRole("button", { name: t.record, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: t.record, exact: true });
    await expect(dialog.getByRole("radio", { name: /LBP|SYP/ })).toHaveCount(0);
    const amount = dialog.getByLabel(t.amount, { exact: true });
    await amount.fill("672.51");
    await expect(dialog.getByRole("button", { name: t.recordPayment, exact: true })).toBeDisabled();
    await expect(dialog.getByText(t.tooMuch)).toBeVisible();
    const typed = locale === "ar" ? "٦٥٠٫٠٠" : "650";
    await amount.fill(typed);
    await expect(amount).toHaveValue(typed);
    await expect(dialog.getByText("$600.00", { exact: true })).toBeVisible();
    await expect(dialog.getByText("$50.00", { exact: true })).toBeVisible();
    await expect(dialog.getByText("$22.50", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: t.recordPayment, exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(t.errorPreview);
    await expectNoHorizontalOverflow(page);
  });

  for (const event of [
    { name: "Loan repayment demo", id: "00000000-0000-4000-8000-000000007003", filter: "expense", cash: "−$650.00", fee: "−$50.00" },
    { name: "Loan income demo", id: "00000000-0000-4000-8000-000000007004", filter: "income", cash: "+$210.00", fee: "+$10.00" },
    { name: "Loan principal demo", id: "00000000-0000-4000-8000-000000007006", filter: "loan", cash: "+$100.00", fee: "$0.00" },
  ]) test(`${locale}: ${event.name} displays gross cash and fee-only daily total`, async ({ page }) => {
    await page.goto(`/${locale}/activity?q=${encodeURIComponent(event.name)}&kind=${event.filter}`);
    const row = page.getByRole("button", { name: new RegExp(event.name) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(event.cash);
    await expect(page.getByText(event.fee, { exact: true })).toBeVisible();
    await row.click();
    const detail = page.getByRole("dialog", { name: messages.Detail.title, exact: true });
    await expect(detail).toBeVisible({ timeout: 10000 });
    for (const label of [messages.Detail.edit, messages.Detail.duplicate, messages.Detail.delete]) await expect(detail.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    await detail.getByRole("link", { name: t.openLoan, exact: true }).click({ timeout: 10000 });
    await expect(page).toHaveURL((url) => url.pathname.endsWith(`/${locale}/loans`) && url.searchParams.get("loanId") === event.id);
    await expect(page.getByRole("dialog", { name: event.name, exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test(`${locale}: void and restore preserve explicit preview errors rather than pretending to persist`, async ({ page }) => {
    await page.goto(`/${locale}/loans?loanId=00000000-0000-4000-8000-000000007003`);
    const detail = page.getByRole("dialog", { name: "Loan repayment demo", exact: true });
    await expect(detail.getByRole("button", { name: t.restore, exact: true })).toHaveCount(0);
    await detail.getByRole("button", { name: t.void, exact: true }).click();
    const confirm = page.getByRole("dialog", { name: t.voidTitle, exact: true });
    await expect(confirm).toContainText(t.voidHelp);
    await confirm.getByRole("button", { name: t.void, exact: true }).click();
    await expect(confirm.getByRole("alert")).toContainText(t.errorPreview);
    await page.goto(`/${locale}/loans?loanId=00000000-0000-4000-8000-000000007005`);
    const restore = page.getByRole("dialog", { name: "Loan restore demo", exact: true });
    await restore.getByRole("button", { name: t.restore, exact: true }).click();
    await expect(restore.getByRole("alert")).toContainText(t.errorPreview);
  });

  test(`${locale}: loan list fits required widths in both themes with LTR amounts`, async ({ page }) => {
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      for (const width of [320, 390, 430, 768, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(`/${locale}/loans`);
        await expectNoHorizontalOverflow(page);
        await expect(page.locator("bdi[dir=ltr]").first()).toBeVisible();
        if (width === 390) await page.screenshot({ path: test.info().outputPath(`loans-${locale}-${theme}-390.png`), fullPage: true });
      }
    }
  });
}
