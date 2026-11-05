import { expect, test } from "@playwright/test";
import en from "../src/messages/en.json";
import ar from "../src/messages/ar.json";
import { expectNoHorizontalOverflow } from "./support";

// The unauthenticated demo cannot persist. Browser coverage checks the real
// guided preview and safety gate; action/unit + disposable PG17 cover mutation.
for (const locale of ["en", "ar"] as const) {
  const messages = locale === "en" ? en : ar;
  test(`${locale}: guided deletion shows exact currency rows and keeps preview non-destructive`, async ({ page }, testInfo) => {
    await page.goto(`/${locale}/wallets`);
    const list = page.getByRole("list", { name: messages.Nav.wallets, exact: true });
    const source = messages.Wallets.editNamed.replace("{name}", "Pocket");
    await list.getByRole("button", { name: source, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: messages.Wallets.deleteWallet, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAccessibleName(messages.WalletDeletion.title.replace("{name}", "Pocket"));
    await expect(dialog.getByRole("alert")).toHaveText(messages.WalletDeletion.preview);
    await expect(dialog.getByText("USD", { exact: true })).toBeVisible();
    await expect(dialog.getByText("LBP", { exact: true })).toBeVisible();
    const destination = dialog.getByRole("combobox", { name: messages.WalletDeletion.destination.replace("{currency}", "USD"), exact: true });
    await expect(destination.getByRole("option", { name: "Pocket", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("combobox")).toHaveCount(2);
    const amountTexts = await dialog.locator(".amount").allTextContents();
    expect(amountTexts).toEqual(["$230.00", "LBP 2,450,000"]);
    for (const select of await dialog.getByRole("combobox").all()) {
      const values = await select.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value).filter(Boolean));
      expect(values.length).toBeGreaterThan(0);
      await select.selectOption(values[0]);
    }
    await expect(dialog.getByRole("button", { name: messages.WalletDeletion.confirm, exact: true })).toBeDisabled();
    await expectNoHorizontalOverflow(page);
    await dialog.getByRole("button", { name: messages.WalletDeletion.reload, exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(messages.WalletDeletion.preview);
    for (const select of await dialog.getByRole("combobox").all()) await expect(select).toHaveValue("");
    await page.screenshot({ path: `.superpowers/sdd/2026-11-05-global-currencies-all-wallets/task-7-${locale}-${testInfo.project.name}.png`, fullPage: true });
    await dialog.getByRole("button", { name: messages.WalletDeletion.cancel, exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName(messages.Wallets.editTitle);
    await page.getByRole("dialog").getByRole("button", { name: messages.Nav.close, exact: true }).click();
    await expect(list.getByRole("button", { name: source, exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
