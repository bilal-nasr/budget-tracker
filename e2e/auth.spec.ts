import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support";

// Demo mode (no Supabase keys): the forms render and validate; submitting valid data reports "not set up".

test("sign-in links to sign-up and back", async ({ page }) => {
  await page.goto("/en/sign-in");
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/en\/sign-up/);
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/sign-in/);
});

test("sign-up form has labelled, password-manager-friendly fields", async ({ page }) => {
  await page.goto("/en/sign-up");
  await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "new-password");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await expectNoHorizontalOverflow(page);
});

test("a password under 8 characters is refused with a clear message", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.getByLabel("Email").fill("someone@example.test");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("at least 8 characters");
});

test("a valid sign-up without a database says it is not set up", async ({ page }) => {
  await page.goto("/en/sign-up");
  await page.getByLabel("Email").fill("someone@example.test");
  await page.getByLabel("Password", { exact: true }).fill("a-long-enough-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("not set up");
});

test("check-email page tells people to open the link, without echoing an address", async ({ page }) => {
  await page.goto("/en/check-email");
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
  expect(page.url()).not.toContain("@");
});

test("an expired confirmation link shows a message on sign-in", async ({ page }) => {
  await page.goto("/en/sign-in?error=link");
  await expect(page.locator("form").getByRole("alert")).toContainText("This link has expired");
});

test("arabic sign-up is RTL with LTR fields and no overflow", async ({ page }) => {
  await page.goto("/ar/sign-up");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(await page.getByLabel("كلمة المرور", { exact: true }).evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
  await expectNoHorizontalOverflow(page);
});

test("the confirm route rejects a missing token and sends people to sign-in", async ({ request }) => {
  const res = await request.get("/auth/confirm?next=//evil.com", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const location = res.headers()["location"];
  expect(location).toMatch(/\/en\/sign-in\?error=link$/);
  expect(location).not.toContain("evil.com");
});
