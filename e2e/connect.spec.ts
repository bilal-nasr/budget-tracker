import { readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support";

// Demo mode (no Supabase keys): the proxy skips auth, so the visitor counts as signed in, and the
// page cannot ask Supabase about any authorization, so EVERY id (valid-looking or not) shows the
// "link no longer works" state. These tests therefore prove that state renders correctly (copy,
// direction, target size, no overflow, axe); they do NOT prove id validation, which is unit-tested
// in src/features/connect/authorization.test.ts (and the proxy/route tests). The signed-out →
// sign-in → back-to-consent journey needs a real session, so it is covered by unit tests of the
// proxy, the auth actions and /auth/confirm, and by the live check against a local stack.

// axe-core is not a direct dependency; it ships in the store with eslint-plugin-jsx-a11y.
function axeScript(): string {
  const store = path.join(process.cwd(), "node_modules", ".pnpm");
  const dir = readdirSync(store).find((name) => name.startsWith("axe-core@"));
  if (!dir) throw new Error("axe-core is not installed");
  return path.join(store, dir, "node_modules", "axe-core", "axe.min.js");
}

async function seriousViolations(page: Page) {
  await page.addScriptTag({ path: axeScript() });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: () => Promise<{ violations: { id: string; impact: string | null }[] }> } }).axe;
    const { violations } = await axe.run();
    return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
  });
}

const copy = {
  en: { title: "This link no longer works", body: "This link has expired.", home: "Go to Budget Tracker", dir: "ltr" },
  ar: { title: "هذا الرابط لم يعد يعمل", body: "انتهت صلاحية هذا الرابط.", home: "الانتقال إلى متتبع الميزانية", dir: "rtl" },
} as const;

for (const locale of ["en", "ar"] as const) {
  test(`${locale}: the expired state renders accessibly and without overflow`, async ({ page }) => {
    const c = copy[locale];
    await page.goto(`/${locale}/connect?authorization_id=notreal123`);
    await expect(page.locator("html")).toHaveAttribute("dir", c.dir);
    await expect(page.getByRole("heading", { level: 1, name: c.title })).toBeVisible();
    await expect(page.getByText(c.body)).toBeVisible();
    const home = page.getByRole("link", { name: c.home });
    await expect(home).toBeVisible();
    expect((await home.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // The expired state offers no Allow or Deny.
    await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    expect(await seriousViolations(page)).toEqual([]);
    await home.click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/?$`));
  });

  // Any address renders the same expired state in demo mode (see the note at the top).
  test(`${locale}: the expired state also renders for a missing or odd-looking address`, async ({ page }) => {
    for (const query of ["", "?authorization_id=../../evil", "?authorization_id=https://evil.example"]) {
      await page.goto(`/${locale}/connect${query}`);
      await expect(page.getByRole("heading", { level: 1, name: copy[locale].title })).toBeVisible();
    }
  });
}

test("Supabase's consent address forwards a valid id to the connect page in the saved language, and drops anything else", async ({ request }) => {
  const ok = await request.get("/oauth/consent?authorization_id=notreal123&redirect_uri=https://evil.example", {
    maxRedirects: 0,
    headers: { cookie: "NEXT_LOCALE=ar" },
  });
  expect(ok.status()).toBe(307);
  expect(ok.headers()["location"]).toMatch(/\/ar\/connect\?authorization_id=notreal123$/);
  expect(ok.headers()["cache-control"]).toContain("no-store");

  const bad = await request.get("/oauth/consent?authorization_id=../evil", { maxRedirects: 0, headers: { "accept-language": "en" } });
  expect(bad.headers()["location"]).toMatch(/\/en\/connect$/);
});
