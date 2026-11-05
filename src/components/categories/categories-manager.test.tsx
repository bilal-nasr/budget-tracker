// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { Category } from "@/features/categories/catalogue";

const mocks = vi.hoisted(() => ({ reorderCategories: vi.fn(), restoreCategory: vi.fn() }));
vi.mock("@/features/categories/actions", () => mocks);
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
import { CategoriesManager } from "./categories-manager";

const category = (id: string, nameEn: string, position: number): Category => ({
  id,
  kind: "expense",
  nameEn,
  nameAr: null,
  tile: 1,
  color: "teal",
  position,
  parentId: null,
  archivedAt: null,
});

const categories = [
  category("00000000-0000-4000-8000-000000000001", "Food", 1),
  category("00000000-0000-4000-8000-000000000002", "Transport", 2),
  category("00000000-0000-4000-8000-000000000003", "Fun", 3),
];

beforeEach(() => {
  mocks.reorderCategories.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("reorders categories from the drag handle with the keyboard and persists the new order", async () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CategoriesManager categories={categories} />
    </NextIntlClientProvider>,
  );

  const handle = screen.getByRole("button", { name: "Reorder Food" });
  fireEvent.keyDown(handle, { key: " " });
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  expect(screen.getByText("Moved Food to position 2 of 3.", { selector: "p" })).toBeTruthy();
  fireEvent.keyDown(handle, { key: " " });

  await waitFor(() => expect(mocks.reorderCategories).toHaveBeenCalledTimes(1));
  expect(mocks.reorderCategories).toHaveBeenCalledWith("expense", [
    categories[1].id,
    categories[0].id,
    categories[2].id,
  ]);
  expect(screen.getAllByRole("listitem").slice(0, 3).map((item) => item.textContent)).toEqual([
    "Transport",
    "Food",
    "Fun",
  ]);
});

it("restores the previous order and announces an error when saving fails", async () => {
  mocks.reorderCategories.mockResolvedValue({ ok: false, error: "failed" });
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CategoriesManager categories={categories} />
    </NextIntlClientProvider>,
  );

  const handle = screen.getByRole("button", { name: "Reorder Food" });
  fireEvent.keyDown(handle, { key: " " });
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  fireEvent.keyDown(handle, { key: " " });

  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(en.Categories.errorFailed));
  expect(screen.getAllByRole("listitem").slice(0, 3).map((item) => item.textContent)).toEqual([
    "Food",
    "Transport",
    "Fun",
  ]);
});
