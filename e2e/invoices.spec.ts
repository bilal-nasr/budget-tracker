import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support";

// A folder's totals list the viewer's default currency (USD in preview) first, then the rest in order of first appearance.
// Preview mode (no database): the demo folders from src/features/invoices/queries.ts.
//   "PC build": owned by the viewer, USD 100.00 + 450.00 + 250.00 = $800.00 and LBP 1,350,000 + 450,000 = 1,800,000.
//   "Living room": owned by someone else, so the viewer can share-leave but not rename or delete.
const DEMO_TOKEN = "d".repeat(64);
const UNKNOWN_TOKEN = "a".repeat(64);

const text = {
  en: {
    wallets: "Invoices",
    title: "Invoices",
    list: "Invoice folders",
    totals: "Totals by currency",
    items: "Items",
    itemName: "Item",
    price: "Price",
    add: "Add item",
    preview: "This is a preview without a database, so nothing can be saved.",
    share: "Share",
    shareTitle: "Share folder",
    rename: "Rename",
    del: "Delete folder",
    createLink: "Create link",
    name: "Your name in this folder",
    leave: "Leave folder",
    close: "Close",
    joinTitle: "Shared folder",
    join: "Join folder",
    invalid: "This link doesn't work. Ask for a new one.",
  },
  ar: {
    wallets: "الفواتير",
    title: "الفواتير",
    list: "مجلدات الفواتير",
    totals: "المجموع لكل عملة",
    items: "البنود",
    itemName: "البند",
    price: "السعر",
    add: "إضافة بند",
    preview: "هذه نسخة تجريبية بلا قاعدة بيانات، لذا لا يمكن الحفظ.",
    share: "مشاركة",
    shareTitle: "مشاركة المجلد",
    rename: "إعادة تسمية",
    del: "حذف المجلد",
    createLink: "إنشاء رابط",
    name: "اسمك في هذا المجلد",
    leave: "مغادرة المجلد",
    close: "إغلاق",
    joinTitle: "مجلد مشترك",
    join: "انضمّ إلى المجلد",
    invalid: "هذا الرابط لا يعمل. اطلب رابطاً جديداً.",
  },
} as const;

async function sizeFor(page: Page, project: string) {
  if (project !== "desktop") await page.setViewportSize({ width: project === "mobile-small" ? 320 : 390, height: 844 });
}

for (const locale of ["en", "ar"] as const) {
  const s = text[locale];

  test(`invoice folders: list, one total per currency, add and share in preview ${locale}`, async ({ page }, testInfo) => {
    await sizeFor(page, testInfo.project.name);
    await page.goto(`/${locale}/wallets`);
    await page.getByRole("link", { name: new RegExp(s.wallets) }).click();
    await expect(page.getByRole("heading", { name: s.title, exact: true })).toBeVisible();

    // The folder list shows both demo folders, each with its own per-currency totals.
    const list = page.getByRole("list", { name: s.list });
    await expect(list.getByRole("link")).toHaveCount(2);
    const pc = list.getByRole("link", { name: /PC build/ });
    const living = list.getByRole("link", { name: /Living room/ });
    await expect(pc).toContainText("$800.00");
    await expect(pc).toContainText("LBP 1,800,000");
    await expect(living).toContainText("$425.00");
    await expect(living).toContainText("LBP 2,700,000");
    await page.screenshot({ path: testInfo.outputPath(`invoices-list-${locale}.png`), fullPage: true, animations: "disabled" });
    await expectNoHorizontalOverflow(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Open PC build: ONE total per currency, as separate lines, never combined.
    await pc.click();
    await expect(page.getByRole("heading", { name: "PC build", exact: true })).toBeVisible();
    const totals = page.getByRole("list", { name: s.totals });
    await expect(totals.getByRole("listitem")).toHaveCount(2);
    await expect(totals.getByRole("listitem").nth(0)).toHaveText("$800.00");
    await expect(totals.getByRole("listitem").nth(1)).toHaveText("LBP 1,800,000");
    // Five rows, each in its own currency; the header never shows a mixed number.
    await expect(page.getByRole("list", { name: s.items }).getByRole("listitem")).toHaveCount(5);
    await expect(page.getByRole("banner")).not.toContainText(/2,?600,?000|1,?800,?800/);
    await page.screenshot({ path: testInfo.outputPath(`invoices-folder-${locale}.png`), fullPage: true, animations: "disabled" });
    await expectNoHorizontalOverflow(page);

    // The owner sees Rename and Delete folder.
    await expect(page.getByRole("button", { name: s.rename, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: s.del, exact: true })).toBeVisible();

    // Adding a row cannot be saved without a database: a plain message, no crash, totals unchanged.
    await page.getByRole("textbox", { name: s.itemName, exact: true }).fill("Fan");
    await page.getByRole("textbox", { name: new RegExp(s.price) }).first().fill("12");
    await page.getByRole("button", { name: s.add, exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: s.preview })).toBeVisible();
    await expect(totals.getByRole("listitem").nth(0)).toHaveText("$800.00");
    await expect(totals.getByRole("listitem").nth(1)).toHaveText("LBP 1,800,000");
    await expect(page.getByRole("heading", { name: "PC build", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`invoices-add-preview-${locale}.png`), fullPage: true, animations: "disabled" });

    // Share: the owner can open the sheet, and creating a link says the same thing.
    await page.getByRole("button", { name: s.share, exact: true }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(s.shareTitle)).toBeVisible();
    await sheet.getByRole("textbox", { name: s.name }).fill("Karim");
    await sheet.getByRole("button", { name: s.createLink, exact: true }).click();
    await expect(sheet.getByRole("alert")).toContainText(s.preview);
    await page.screenshot({ path: testInfo.outputPath(`invoices-share-${locale}.png`), animations: "disabled" });
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`invoice folders: a folder the viewer does not own has no rename or delete ${locale}`, async ({ page }, testInfo) => {
    await sizeFor(page, testInfo.project.name);
    await page.goto(`/${locale}/invoices`);
    await page.getByRole("list", { name: s.list }).getByRole("link", { name: /Living room/ }).click();
    await expect(page.getByRole("heading", { name: "Living room", exact: true })).toBeVisible();
    const totals = page.getByRole("list", { name: s.totals });
    await expect(totals.getByRole("listitem")).toHaveCount(2);
    await expect(totals.getByRole("listitem").nth(0)).toHaveText("$425.00");
    await expect(totals.getByRole("listitem").nth(1)).toHaveText("LBP 2,700,000");
    // Rows added by other people show who added them.
    await expect(page.getByRole("list", { name: s.items })).toContainText("Karim");
    await expect(page.getByRole("button", { name: s.rename, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: s.del, exact: true })).toHaveCount(0);
    // Share opens the read-only state: no link controls, and a way to leave.
    await page.getByRole("button", { name: s.share, exact: true }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: s.createLink, exact: true })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: s.leave, exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`invoices-share-member-${locale}.png`), animations: "disabled" });
    await expectNoHorizontalOverflow(page);
  });

  test(`invoice folders: join links, working and not ${locale}`, async ({ page }, testInfo) => {
    await sizeFor(page, testInfo.project.name);

    // The demo link is well formed and known in preview mode: it asks first, with the folder name.
    await page.goto(`/${locale}/invoices/join/${DEMO_TOKEN}`);
    await expect(page.getByRole("heading", { name: s.joinTitle, exact: true })).toBeVisible();
    await expect(page.getByText("Living room")).toBeVisible();
    await expect(page.getByRole("button", { name: s.join, exact: true })).toBeVisible();
    await expect(page.getByText(s.invalid)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`invoices-join-${locale}.png`), fullPage: true, animations: "disabled" });
    await expectNoHorizontalOverflow(page);

    // Well formed but unknown, and malformed: the same generic message, never an error page.
    for (const token of [UNKNOWN_TOKEN, "not-a-token", "../../etc"]) {
      await page.goto(`/${locale}/invoices/join/${encodeURIComponent(token)}`);
      await expect(page.getByText(s.invalid)).toBeVisible();
      await expect(page.getByRole("button", { name: s.join, exact: true })).toHaveCount(0);
    }
    await page.screenshot({ path: testInfo.outputPath(`invoices-join-invalid-${locale}.png`), fullPage: true, animations: "disabled" });
    await expectNoHorizontalOverflow(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
