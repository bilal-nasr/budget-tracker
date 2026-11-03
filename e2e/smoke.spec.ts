import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support";

const ROUTES = ["", "/activity", "/budgets", "/wallets", "/settings", "/sign-in", "/onboarding"];

for (const locale of ["en", "ar"] as const) {
  for (const route of ROUTES) {
    test(`${locale}${route || "/"}: renders, correct dir, no horizontal overflow`, async ({ page }) => {
      await page.goto(`/${locale}${route}`);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
      await expectNoHorizontalOverflow(page);
    });
  }
}

test("navigation matches the screen size and Add opens the sheet", async ({ page }) => {
  await page.goto("/en");
  const width = page.viewportSize()!.width;
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  // Exactly one navigation is visible: bottom bar (<768), rail (768-1023) or sidebar (>=1024).
  await expect(nav.filter({ visible: true })).toHaveCount(1);
  const box = await nav.filter({ visible: true }).boundingBox();
  if (width < 768) {
    expect(box!.y + box!.height).toBeGreaterThan(page.viewportSize()!.height - 2);
  } else {
    expect(box!.x).toBeLessThanOrEqual(1);
    expect(box!.width).toBeGreaterThanOrEqual(width >= 1024 ? 230 : 76);
  }
  await expect(page.getByRole("link", { name: "Home" }).filter({ visible: true })).toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: "Add" }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("touch targets in navigation are at least 44px", async ({ page }) => {
  await page.goto("/en");
  const links = page.getByRole("navigation", { name: "Main navigation" }).filter({ visible: true }).getByRole("link");
  for (const link of await links.all()) {
    const box = await link.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(43.5);
    expect(box!.width).toBeGreaterThanOrEqual(43.5);
  }
});

test("language switch in settings flips direction", async ({ page }) => {
  await page.goto("/en/settings");
  await page.getByRole("radiogroup", { name: "Language" }).getByText("العربية").click();
  await expect(page).toHaveURL(/\/ar\/settings/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("sign-in form has labelled, autofill-friendly fields", async ({ page }) => {
  await page.goto("/en/sign-in");
  await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "username");
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
});
