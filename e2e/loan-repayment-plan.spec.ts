import { expect, test } from "@playwright/test";
import en from "../src/messages/en.json";
import ar from "../src/messages/ar.json";
import { expectNoHorizontalOverflow } from "./support";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { pointer-events: none !important; }";
    document.head.appendChild(style);
  }, { once: true }));
});

for (const locale of ["en", "ar"] as const) {
  const t = (locale === "ar" ? ar : en).Loans;
  for (const direction of ["borrowed", "lent"] as const) {
    test(`${locale}: ${direction} calculates final payment from the inclusive count`, async ({ page }, info) => {
      await page.goto(`/${locale}/loans`);
      await page.getByRole("button", { name: t.add, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: t.add, exact: true });
      await dialog.getByRole("radio", { name: t[direction], exact: true }).check();
      await dialog.getByLabel(t.name, { exact: true }).fill("Monthly plan example");
      await dialog.getByLabel(t.principal, { exact: true }).fill(locale === "ar" ? "٢٠٠٠" : "2000");
      await dialog.getByRole("radio", { name: t.existing, exact: true }).check();
      await dialog.getByRole("combobox", { name: t.category }).click();
      await page.getByRole("listbox").getByRole("option").first().click();
      await dialog.getByLabel(t.monthlyPayment, { exact: true }).fill(locale === "ar" ? "٢٨٥" : "285");
      const count = dialog.getByLabel(t.paymentCount, { exact: true });
      await count.fill(locale === "ar" ? "٧" : "7");
      await expect(dialog.getByTestId("loan-final-payment")).toHaveText("$290.00");
      const save = dialog.getByRole("button", { name: t.save, exact: true });
      await expect(save).toBeEnabled();
      await expectNoHorizontalOverflow(page);
      if (direction === "borrowed") {
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await page.waitForTimeout(550);
        await page.screenshot({ path: `.impeccable/review/loan-plan/${locale}-${info.project.name}-create.png` });
      }
      await count.fill("9");
      await expect(dialog.getByText(t.invalidPlan, { exact: true })).toBeVisible();
      await expect(save).toBeDisabled();
      await count.fill("");
      await dialog.getByLabel(t.monthlyPayment, { exact: true }).fill("");
      await expect(save).toBeEnabled();
    });
  }

  test(`${locale}: saved plan shows the calculated final payment and suggests monthly amount`, async ({ page }, info) => {
    await page.goto(`/${locale}/loans?loanId=00000000-0000-4000-8000-000000007008`);
    const detail = page.getByRole("dialog", { name: "Monthly repayment demo", exact: true });
    await expect(detail.getByText("$285.00", { exact: true })).toBeVisible();
    await expect(detail.getByText("$290.00", { exact: true })).toBeVisible();
    await detail.getByRole("button", { name: t.record, exact: true }).click();
    const payment = page.getByRole("dialog", { name: t.record, exact: true });
    await expect(payment.getByLabel(t.amount, { exact: true })).toHaveValue("285");
    await expect(payment.getByText(t.suggestMonthly, { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.waitForTimeout(550);
    await page.screenshot({ path: `.impeccable/review/loan-plan/${locale}-${info.project.name}-payment.png` });
  });
}
