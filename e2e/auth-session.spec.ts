import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Default demo lane discovers this file too, but cannot exercise real sessions.
// The dedicated config fails clearly if explicitly invoked without credentials.
test.skip(!process.env.AUTH_E2E_BASE_URL, "Use playwright.auth.config.ts with a disposable configured Auth app.");

for (const locale of ["en", "ar"] as const) {
  test(`${locale}: session survives browser restart and sign-out survives another restart`, async ({ playwright, browserName, baseURL }) => {
    const profile = await mkdtemp(join(tmpdir(), "budget-auth-e2e-"));
    const browserType = playwright[browserName];
    const url = (path: string) => `${baseURL!.replace(/\/$/, "")}/${locale}${path}`;
    const launch = () => browserType.launchPersistentContext(profile, {
      headless: true, viewport: { width: 390, height: 844 },
      // Do not save traces, screenshots, storageState, or response bodies: they
      // may contain synthetic session credentials even in this disposable lane.
    });
    let context = await launch();
    try {
      let page = context.pages()[0] ?? await context.newPage();
      await page.goto(url("/sign-in"));
      await page.locator("input[name=email]").fill(process.env.AUTH_E2E_EMAIL!);
      await page.locator("input[name=password]").fill(process.env.AUTH_E2E_PASSWORD!);
      const actionResponse = page.waitForResponse((response) => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"]));
      await page.locator("form button[type=submit]").click();
      expect((await actionResponse).headers()["cache-control"]).toContain("no-store");
      await expect(page).not.toHaveURL(/\/sign-in/);
      await page.goto(url("/wallets"));
      await expect(page).toHaveURL(url("/wallets"));
      const cookies = (await context.cookies()).filter(({ name }) => /^sb-.*-auth-token(?:\.\d+)?$/.test(name));
      expect(cookies.length).toBeGreaterThan(0);
      // Cookie retention and server timebox are distinct; default SSR cookies
      // must persist beyond a normal browser process restart.
      expect(cookies.every(({ expires }) => expires > Date.now() / 1000 + 30 * 86400)).toBe(true);
      await context.close();

      context = await launch();
      page = context.pages()[0] ?? await context.newPage();
      await page.goto(url("/wallets"));
      await expect(page).toHaveURL(url("/wallets"));
      // Exercise real next-intl/Auth redirect composition in each locale.
      await page.goto(url("/sign-in"));
      await expect(page).not.toHaveURL(/\/sign-in/);
      const otherTab = await context.newPage();
      await Promise.all([page.goto(url("/wallets")), otherTab.goto(url("/activity"))]);
      await expect(page).toHaveURL(url("/wallets"));
      await expect(otherTab).toHaveURL(url("/activity"));
      await otherTab.close();

      await page.goto(url("/settings"));
      await page.getByRole("button", { name: locale === "en" ? "Sign out" : "تسجيل الخروج", exact: true }).click();
      await expect(page).toHaveURL(url("/sign-in"));
      expect((await context.cookies()).filter(({ name }) => /^sb-.*-auth-token(?:\.\d+)?$/.test(name))).toHaveLength(0);
      await context.close();

      context = await launch();
      page = context.pages()[0] ?? await context.newPage();
      await page.goto(url("/wallets"));
      await expect(page).toHaveURL(url("/sign-in"));
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
