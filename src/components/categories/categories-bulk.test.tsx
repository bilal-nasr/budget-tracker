// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "@/messages/en.json";
import type { Category } from "@/features/categories/catalogue";

const bulk = vi.hoisted(() => ({ removeCategories: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/features/categories/actions", () => ({ reorderCategories: vi.fn(), restoreCategory: vi.fn() }));
vi.mock("@/features/categories/bulk-actions", () => bulk);
vi.mock("sonner", () => ({ toast }));
// Lazy sheets: the confirm sheet becomes a plain dialog, the editor stays out of the way.
vi.mock("next/dynamic", () => ({
  default: () => (props: { open?: boolean; title?: string; children?: ReactNode; confirmLabel?: string; onConfirm?: () => void }) =>
    props.onConfirm && props.open ? <div role="dialog" aria-label={props.title}>{props.children}<button type="button" onClick={props.onConfirm}>{`Confirm ${props.confirmLabel}`}</button></div> : null,
}));
import { CategoriesManager } from "./categories-manager";

const category = (n: number, nameEn: string, kind: Category["kind"] = "expense"): Category => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, kind, nameEn, nameAr: null, tile: 1, color: "teal", position: n, parentId: null, archivedAt: null,
});
const categories = [category(1, "Food"), category(2, "Transport"), category(3, "Fun"), category(4, "Salary", "income")];
const view = () => render(<NextIntlClientProvider locale="en" messages={en}><CategoriesManager categories={categories} /></NextIntlClientProvider>);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("removes the ticked categories in one request after a confirmation that names the count", async () => {
  bulk.removeCategories.mockResolvedValue({ ok: true, deleted: 1, archived: 1 });
  view();
  fireEvent.click(screen.getByRole("button", { name: "Select categories" }));
  expect(screen.queryByRole("button", { name: "Reorder Food" })).toBeNull();
  expect((screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Food" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Fun" }));
  expect(screen.getByText("2 selected")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(screen.getByRole("dialog", { name: "Remove 2 categories?" })).toBeTruthy();
  expect(bulk.removeCategories).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm Remove" }));
  await waitFor(() => expect(bulk.removeCategories).toHaveBeenCalledExactlyOnceWith([categories[0].id, categories[2].id]));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("2 categories removed"));
  expect(screen.queryByRole("region", { name: "Selected categories" })).toBeNull();
  expect(screen.getByRole("button", { name: "Reorder Food" })).toBeTruthy();
});

it("names the category that blocks the batch and keeps the selection", async () => {
  bulk.removeCategories.mockResolvedValue({ ok: false, error: "inUse", blockedId: categories[1].id });
  view();
  fireEvent.click(screen.getByRole("button", { name: "Select categories" }));
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByText("3 selected")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm Remove" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("“Transport” is still used"));
  expect(screen.getByRole("alert").textContent).toContain("Nothing was removed");
  expect(toast).not.toHaveBeenCalled();
  expect(screen.getByText("3 selected")).toBeTruthy();
});

it("leaves select mode when the category type changes", () => {
  view();
  fireEvent.click(screen.getByRole("button", { name: "Select categories" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Food" }));
  fireEvent.click(screen.getByRole("radio", { name: "Income" }));
  expect(screen.queryByRole("region", { name: "Selected categories" })).toBeNull();
  // One income category: nothing to select several of.
  expect(screen.queryByRole("button", { name: "Select categories" })).toBeNull();
});
