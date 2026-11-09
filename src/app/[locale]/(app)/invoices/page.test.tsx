import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("@/features/invoices/queries", () => ({ getInvoiceFolders: async () => [] }));
vi.mock("@/components/invoices/folders-view", () => ({ FoldersView: () => null }));
import InvoicesPage from "./page";

const page = (searchParams: Record<string, string | string[] | undefined>) =>
  InvoicesPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve(searchParams) });

it("passes the lost-access flag only for unavailable=1", async () => {
  expect((await page({ unavailable: "1" })).props.unavailable).toBe(true);
  expect((await page({})).props.unavailable).toBe(false);
  expect((await page({ unavailable: "yes" })).props.unavailable).toBe(false);
  expect((await page({ unavailable: ["1", "1"] })).props.unavailable).toBe(false);
});
