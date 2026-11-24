import { readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support";

// Demo mode (no Supabase keys): there is no backend, so no app can be listed and nothing can be
// removed. These tests prove only the block's empty/help state: it renders in both languages and
// directions with the connector address (always left to right), tap targets of at least 44px, no
// horizontal overflow and no serious axe violations. Listing an app, the Remove sheet and the
// removal itself need a real session; they are covered by the component tests
// (connected-apps-view.test.tsx), the action tests, and the live check against a local stack.

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
  en: { title: "Connected apps", empty: "No apps connected yet.", how: "Connect Claude", address: "Connector address", copyAddress: "Copy connector address", copyAppId: "Copy app ID" },
  ar: { title: "التطبيقات المتصلة", empty: "لا توجد تطبيقات متصلة بعد.", how: "ربط Claude", address: "عنوان الموصِّل", copyAddress: "نسخ عنوان الموصِّل", copyAppId: "نسخ معرّف التطبيق" },
} as const;

for (const locale of ["en", "ar"] as const) {
  test(`${locale}: Settings shows the connected apps empty state with the help open`, async ({ page }) => {
    const c = copy[locale];
    await page.goto(`/${locale}/settings`);
    const section = page.getByRole("region", { name: c.title });
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible();
    await expect(section.getByText(c.empty)).toBeVisible();

    const help = section.locator("details");
    await expect(help).toHaveAttribute("open", "");
    await expect(help.getByText(c.address)).toBeVisible();
    // The address reads left to right even on a right-to-left page.
    const address = help.locator("bdi[dir='ltr']").first();
    await expect(address).toContainText("/mcp");

    // The address's Copy button is always there; an app id's only when an app is registered.
    await expect(help.getByRole("button", { name: c.copyAddress, exact: true })).toHaveCount(1);
    const copyButtons = [
      ...(await help.getByRole("button", { name: c.copyAddress, exact: true }).all()),
      ...(await help.getByRole("button", { name: c.copyAppId, exact: true }).all()),
    ];
    for (const button of copyButtons) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    const summary = help.locator("summary");
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await expectNoHorizontalOverflow(page);
    expect(await seriousViolations(page)).toEqual([]);

    // Folding and unfolding the help keeps the page inside the screen.
    await summary.click();
    await expect(help).not.toHaveAttribute("open", "");
    await expectNoHorizontalOverflow(page);
  });
}
