// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import type { InvoiceCategory } from "@/features/invoices/schema";

const mocks = vi.hoisted(() => ({ addCategory: vi.fn(), renameCategory: vi.fn(), deleteCategory: vi.fn() }));
vi.mock("@/features/invoices/actions", () => mocks);
vi.mock("@/components/ui/sheet-shell", () => ({
  SheetShell: ({ open, title, children, footer }: { open: boolean; title: string; children: React.ReactNode; footer?: React.ReactNode }) =>
    open ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null,
}));
import { CategoriesSheet } from "./categories-sheet";

const FOLDER = "1f000000-0000-4000-8000-000000000001";
const category = (n: number, name: string, isDefault = false): InvoiceCategory =>
  ({ id: `1c000000-0000-4000-8000-${String(n).padStart(12, "0")}`, folderId: FOLDER, name, isDefault, createdAt: `2026-11-0${n}T00:00:00Z` });
const CASE = category(1, "Case & Cooling");
const OTHER = category(2, "Other", true);

const catalogs = { en, ar } as const;
const handlers = () => ({ onClose: vi.fn(), onAdded: vi.fn(), onRenamed: vi.fn(), onDeleted: vi.fn() });

function view(locale: keyof typeof catalogs, on: ReturnType<typeof handlers>, categories = [CASE, OTHER]) {
  return render(
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]}>
      <CategoriesSheet folderId={FOLDER} categories={categories} counts={new Map([[CASE.id, 2], [OTHER.id, 1]])} {...on} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => { Object.values(mocks).forEach((fn) => fn.mockReset().mockResolvedValue({ ok: true })); });
afterEach(cleanup);

describe.each(["en", "ar"] as const)("CategoriesSheet (%s)", (locale) => {
  const t = catalogs[locale].Invoices;

  it("lists the categories with their row counts, and offers no rename or delete for the default", () => {
    view(locale, handlers());
    const list = screen.getByRole("list", { name: t.categoriesLabel });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Case & Cooling")).toBeTruthy();
    expect(within(rows[0]).getAllByRole("button")).toHaveLength(2);
    expect(within(rows[1]).getByText(t.categoryOther)).toBeTruthy();
    expect(within(rows[1]).queryAllByRole("button")).toHaveLength(0);
  });

  it("adds a trimmed name with a client-chosen id, then clears the field", async () => {
    const on = handlers();
    view(locale, on);
    const field = screen.getByLabelText(t.newCategory) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "  Storage " } });
    await act(async () => { fireEvent.submit(field.form!); });
    expect(mocks.addCategory).toHaveBeenCalledWith({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), folderId: FOLDER, name: "Storage" });
    expect(on.onAdded).toHaveBeenCalledWith(expect.objectContaining({ name: "Storage", isDefault: false, folderId: FOLDER }));
    expect(field.value).toBe("");
  });

  it("refuses a name that is already used, ignoring case, and the default's own name", async () => {
    view(locale, handlers());
    const field = screen.getByLabelText(t.newCategory) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "case & cooling" } });
    expect(screen.getByRole("alert").textContent).toBe(t.categoryExists);
    await act(async () => { fireEvent.submit(field.form!); });
    expect(mocks.addCategory).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: t.categoryOther } });
    expect(screen.getByRole("alert").textContent).toBe(t.categoryExists);
  });

  it("keeps the typed name and says why when saving fails", async () => {
    mocks.addCategory.mockResolvedValue({ ok: false, error: "limitReached" });
    const on = handlers();
    view(locale, on);
    const field = screen.getByLabelText(t.newCategory) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Storage" } });
    await act(async () => { fireEvent.submit(field.form!); });
    expect(on.onAdded).not.toHaveBeenCalled();
    expect(field.value).toBe("Storage");
    expect(screen.getByRole("alert").textContent).toBe(t.errorLimit);
  });

  it("renames in place", async () => {
    const on = handlers();
    view(locale, on);
    fireEvent.click(screen.getByRole("button", { name: t.renameCategoryNamed.replace("{name}", "Case & Cooling") }));
    const field = screen.getByLabelText(t.renameCategory) as HTMLInputElement;
    expect(field.value).toBe("Case & Cooling");
    fireEvent.change(field, { target: { value: " Cooling " } });
    await act(async () => { fireEvent.submit(field.form!); });
    expect(mocks.renameCategory).toHaveBeenCalledWith(CASE.id, { name: "Cooling" });
    expect(on.onRenamed).toHaveBeenCalledWith(CASE.id, "Cooling");
    expect(screen.queryByLabelText(t.renameCategory)).toBeNull();
  });

  it("asks before deleting, and deleting moves on only when the server says so", async () => {
    const on = handlers();
    view(locale, on);
    fireEvent.click(screen.getByRole("button", { name: t.deleteCategoryNamed.replace("{name}", "Case & Cooling") }));
    expect(mocks.deleteCategory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t.keepCategory }));
    expect(screen.getByText("Case & Cooling")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: t.deleteCategoryNamed.replace("{name}", "Case & Cooling") }));
    mocks.deleteCategory.mockResolvedValueOnce({ ok: false, error: "failed" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: t.deleteCategory })); });
    expect(on.onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(t.errorFailed);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: t.deleteCategory })); });
    expect(mocks.deleteCategory).toHaveBeenLastCalledWith(CASE.id);
    expect(on.onDeleted).toHaveBeenCalledWith(CASE.id);
  });
});
