// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";

const mocks = vi.hoisted(() => ({ locale: "en", folderCount: vi.fn() }));
vi.mock("next-intl/server", async () => {
  const intl = await import("next-intl");
  const catalogs = (await import("@/messages/en.json")).default;
  const arabic = (await import("@/messages/ar.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      intl.createTranslator({ locale: mocks.locale, messages: mocks.locale === "ar" ? arabic : catalogs, namespace: namespace as never }),
  };
});
vi.mock("@/features/items/queries", () => ({ getShoppingItems: async () => [] }));
vi.mock("@/features/loans/queries", () => ({ getLoans: async () => [] }));
vi.mock("@/features/pending-payments/queries", () => ({ getPendingPayments: async () => [] }));
// Only the count: the row must never read the folders' items (a missing export would throw).
vi.mock("@/features/invoices/queries", () => ({ getInvoiceFolderCount: mocks.folderCount }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}));
import { AppDataProvider } from "@/components/providers/app-data";
import { Commitments } from "./commitments";

async function renderRow(locale: "en" | "ar") {
  mocks.locale = locale;
  const node = await Commitments();
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : en}>
      <AppDataProvider walletContainers={[]} currencies={[
        { code: "USD", symbol: "$", decimalPlaces: 2, disabled: false, firstUsed: true },
        { code: "LBP", symbol: "LBP", decimalPlaces: 0, disabled: false, firstUsed: true },
      ]} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}>{node}</AppDataProvider>
    </NextIntlClientProvider>,
  );
  return screen.getByRole("link", { name: new RegExp(locale === "ar" ? ar.Invoices.title : en.Invoices.title) });
}

beforeEach(() => { mocks.folderCount.mockReset().mockResolvedValue(0); });
afterEach(cleanup);

describe.each(["en", "ar"] as const)("%s", (locale) => {
  const w = (locale === "ar" ? ar : en).Wallets;

  it("lists Invoices right after the Item calculator and opens /invoices", async () => {
    const row = await renderRow(locale);
    expect(row.getAttribute("href")).toBe("/invoices");
    const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links.indexOf("/invoices")).toBe(links.indexOf("/items") + 1);
  });

  it("says there are no folders yet when there are none", async () => {
    const row = await renderRow(locale);
    expect(row.textContent).toContain(w.noFolders);
  });

  it("counts the folders and shows no money at all", async () => {
    mocks.folderCount.mockResolvedValue(3);
    const row = await renderRow(locale);
    expect(row.textContent).toContain(locale === "ar" ? "3 مجلدات" : "3 folders");
    expect(row.textContent).toContain((locale === "ar" ? ar : en).Invoices.title);
    // Folders are not wallet money: no amounts, no currency codes, no "too large" lines.
    expect(row.querySelector(".amount")).toBeNull();
    expect(row.textContent).not.toMatch(/[$]|LBP|USD|SYP|EUR|\d{3}/);
  });

  it("one folder uses the singular form", async () => {
    mocks.folderCount.mockResolvedValue(1);
    const row = await renderRow(locale);
    expect(row.textContent).toContain(locale === "ar" ? "مجلد واحد" : "1 folder");
    expect(row.textContent).not.toContain("1 folders");
  });

  it("a failed folder read leaves the row without a count rather than breaking Wallets", async () => {
    mocks.folderCount.mockRejectedValue(new Error("down"));
    const row = await renderRow(locale);
    expect(row.textContent).toContain(w.noFolders);
  });

  it("the other rows keep their hints when there is nothing in them", async () => {
    await renderRow(locale);
    const text = screen.getByRole("link", { name: new RegExp((locale === "ar" ? ar : en).Loans.title) }).textContent;
    expect(text).toContain(w.noneActive);
    expect(screen.getByRole("link", { name: new RegExp((locale === "ar" ? ar : en).PendingPayments.title) }).textContent).toContain(w.nothingPending);
    expect(screen.getByRole("link", { name: new RegExp((locale === "ar" ? ar : en).Items.title) }).textContent).toContain(w.nothingListed);
  });
});
