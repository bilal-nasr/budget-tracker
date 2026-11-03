import { expect, test } from "@playwright/test";

const switchToArabic = (page: import("@playwright/test").Page) =>
  page.getByRole("radiogroup", { name: "Language" }).getByText("العربية").click();

test("system theme on a dark phone stays dark after switching to Arabic", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/en/settings");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await switchToArabic(page);
  await expect(page).toHaveURL(/\/ar\/settings/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});

test("saved Dark stays dark on a light phone after switching language", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/en/settings");
  await page.getByRole("radiogroup", { name: "Theme" }).getByText("Dark").click();
  await switchToArabic(page);
  await expect(page).toHaveURL(/\/ar\/settings/);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});

test("saved Light stays light on a dark phone after switching language", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/en/settings");
  await page.getByRole("radiogroup", { name: "Theme" }).getByText("Light").click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await switchToArabic(page);
  await expect(page).toHaveURL(/\/ar\/settings/);
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});

test("System follows the phone when it changes while the app is open", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/en/settings");
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});

test("switching language navigates once and never re-renders the old language", async ({ page }) => {
  await page.goto("/en/settings");
  const oldLocale: string[] = [];
  page.on("request", (r) => {
    const { pathname } = new URL(r.url());
    // The saveLocale POST goes to the current URL; only GETs would be re-renders.
    if (pathname.startsWith("/en/settings") && r.method() === "GET") oldLocale.push(pathname);
  });
  await switchToArabic(page);
  await expect(page).toHaveURL(/\/ar\/settings/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(oldLocale).toEqual([]);
});
