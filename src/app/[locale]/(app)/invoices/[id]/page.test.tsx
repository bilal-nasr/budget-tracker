import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInvoiceFolder: vi.fn(),
  redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/i18n/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/invoices/queries", () => ({ getInvoiceFolder: mocks.getInvoiceFolder }));
vi.mock("@/components/invoices/folder-view", () => ({ FolderView: () => null }));
import InvoiceFolderPage from "./page";

const FOLDER = "1f000000-0000-4000-8000-000000000001";
const page = (locale = "en", id = FOLDER) => InvoiceFolderPage({ params: Promise.resolve({ locale, id }) });

beforeEach(() => { for (const fn of Object.values(mocks)) fn.mockClear(); });

it.each(["en", "ar"])("a folder the viewer cannot open (missing, never joined or removed) goes to the list with a notice in %s", async (locale) => {
  mocks.getInvoiceFolder.mockResolvedValue(null);
  await expect(page(locale)).rejects.toThrow("NEXT_REDIRECT");
  expect(mocks.redirect).toHaveBeenCalledWith({ href: { pathname: "/invoices", query: { unavailable: "1" } }, locale });
  expect(mocks.notFound).not.toHaveBeenCalled();
});

it("renders the folder for an active member", async () => {
  const folder = { id: FOLDER, name: "PC build", isOwner: true, viewerId: "v", items: [], members: [], link: null };
  mocks.getInvoiceFolder.mockResolvedValue(folder);
  const element = await page();
  expect(element.props.folder).toBe(folder);
  expect(mocks.redirect).not.toHaveBeenCalled();
});
