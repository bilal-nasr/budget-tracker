// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import type { Category } from "./schema";

const mock = vi.hoisted(() => ({ createCategory: vi.fn(), updateCategory: vi.fn(), removeCategory: vi.fn(), restoreCategory: vi.fn(), toast: vi.fn() }));
vi.mock("./actions", () => mock);
vi.mock("sonner", () => ({ toast: mock.toast }));
vi.mock("@/components/ui/sheet-shell", () => ({ SheetShell: ({ open, title, children, footer }: { open: boolean; title: string; children: React.ReactNode; footer?: React.ReactNode }) => open ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null }));
import { CategoriesManager } from "@/components/categories/categories-manager";

const category: Category = { id: "aaaaaaaa-0000-4000-8000-000000000001", kind: "expense", nameEn: "Food", nameAr: "طعام", tile: 1, color: "teal", position: 1, parentId: null, archivedAt: null };
const categoryMessages = { en: en.Categories, ar: ar.Categories };
function mount(locale: "en" | "ar" = "en", categories: Category[] = [category]) {
  return render(<NextIntlClientProvider locale={locale} messages={{ Categories: categoryMessages[locale] }}><CategoriesManager categories={categories} /></NextIntlClientProvider>);
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("opens a compact editor with a single-language name and all eight existing motifs", async () => {
  mock.createCategory.mockResolvedValue({ ok: false, error: "notConfigured" });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Add category" }));
  await screen.findByRole("dialog"); // the editor loads on first open
  expect(screen.getAllByRole("radio").length).toBe(13); // 2 kind + 8 tile + 3 color
  fireEvent.change(screen.getByLabelText("Arabic name"), { target: { value: "هدايا" } });
  fireEvent.click(screen.getByRole("button", { name: "Save category" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("preview without a database"));
  expect(mock.createCategory).toHaveBeenCalledWith(expect.objectContaining({ kind: "expense", nameEn: null, nameAr: "هدايا" }));
  expect(screen.getByText("Food")).toBeTruthy();
});
it("confirms removal and explains history, budget and template behavior", async () => {
  mock.removeCategory.mockResolvedValue({ ok: false, error: "inUse" });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Edit Food" }));
  fireEvent.click(await screen.findByRole("button", { name: "Remove category" }));
  expect(screen.getByRole("dialog", { name: "Remove this category?" }).textContent).toContain("Existing budget limits continue");
  expect(mock.removeCategory).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /^Remove$/ }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Reassign fixed expenses"));
  expect(screen.getByRole("button", { name: "Edit Food" })).toBeTruthy();
});
it("rolls back a failed archive restore and shows the duplicate recovery", async () => {
  mock.restoreCategory.mockResolvedValue({ ok: false, error: "duplicateName" });
  mount("en", [{ ...category, archivedAt: "2026-11-04" }]);
  fireEvent.click(screen.getByText("Archived categories (1)"));
  fireEvent.click(screen.getByRole("button", { name: "Restore Food" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already has this name"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Restore Food" })).toBeTruthy());
});
it("uses Arabic labels and isolates a custom category name", async () => {
  mount("ar");
  const edit = screen.getByRole("button", { name: "تعديل طعام" });
  expect(edit.querySelector("bdi")?.textContent).toBe("طعام");
  fireEvent.click(edit);
  expect(await screen.findByLabelText("الاسم بالعربية")).toBeTruthy();
  expect(screen.getByRole("radio", { name: "معيّن" })).toBeTruthy();
});

it("retains editor input when a request is interrupted", async () => {
  mock.createCategory.mockRejectedValue(new Error("connection lost"));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Add category" }));
  fireEvent.change(await screen.findByLabelText("English name"), { target: { value: "Travel" } });
  fireEvent.click(screen.getByRole("button", { name: "Save category" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not be saved"));
  expect((screen.getByLabelText("English name") as HTMLInputElement).value).toBe("Travel");
});

it("rolls back optimistic restore when the request rejects", async () => {
  mock.restoreCategory.mockRejectedValue(new Error("connection lost"));
  mount("en", [{ ...category, archivedAt: "2026-11-04" }]);
  fireEvent.click(screen.getByText("Archived categories (1)"));
  fireEvent.click(screen.getByRole("button", { name: "Restore Food" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not be saved"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Restore Food" })).toBeTruthy());
});
