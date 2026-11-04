import { expect, test } from "@playwright/test";

const switchToArabic = (page: import("@playwright/test").Page) =>
  page.getByRole("radiogroup", { name: "Language" }).getByText("العربية").click();

test("Arabic persists through navigation, reloads, and a new browser session", async ({ page, context, browser, baseURL }) => {
  await page.goto("/en/settings");
  await switchToArabic(page);
  await expect(page).toHaveURL(/\/ar\/settings/);
  await page.goto("/ar/wallets");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");

  const cookie = (await context.cookies()).find(({ name }) => name === "NEXT_LOCALE");
  expect(cookie?.value).toBe("ar");
  expect(cookie?.path).toBe("/");
  expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 60 * 60 * 24 * 364);

  // Browser restarts retain persistent cookies, but discard session cookies.
  const state = await context.storageState();
  const reopened = await browser.newContext({
    baseURL,
    storageState: { ...state, cookies: state.cookies.filter(({ expires }) => expires > Date.now() / 1000) },
  });
  try {
    const tab = await reopened.newPage();
    await tab.goto("/");
    await expect(tab).toHaveURL(/\/ar\/?$/);
    await expect(tab.locator("html")).toHaveAttribute("dir", "rtl");
  } finally {
    await reopened.close();
  }
});

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
