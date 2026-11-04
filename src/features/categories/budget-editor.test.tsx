// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { Category } from "./schema";
const mock = vi.hoisted(() => ({ saveBudgets: vi.fn(), categories: [] as Category[] }));
vi.mock("@/components/providers/app-data", () => ({ useAppData: () => ({ categories: mock.categories }) }));
vi.mock("@/features/budgets/actions", () => ({ saveBudgets: mock.saveBudgets }));
vi.mock("@/components/money/amount", () => ({ Amount: ({ minor }: { minor: number }) => <bdi>{minor}</bdi> }));
vi.mock("@/components/ui/sheet-shell", () => ({ SheetShell: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div> }));
import { BudgetsSheet } from "@/components/budget/budgets-sheet";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("keeps raw SYP budget drafts editable when their total exceeds the money domain", () => {
  const category: Category = { id: "one", kind: "expense", nameEn: "One", nameAr: null, tile: 1, color: "teal", position: 1, parentId: null, archivedAt: null };
  mock.categories = [category, { ...category, id: "two", nameEn: "Two", position: 2 }];
  render(<NextIntlClientProvider locale="en" messages={en}><BudgetsSheet state={{ data: { month: "2026-11", currency: "SYP", rows: [], totalLimitMinor: 0, totalSpentMinor: 0 }, salaryAfterMinor: null }} onClose={() => {}} /></NextIntlClientProvider>);
  const first = screen.getByRole("textbox", { name: en.Budgets.amountFor.replace("{name}", "One") }) as HTMLInputElement;
  fireEvent.change(first, { target: { value: "1000000000000000" } });
  fireEvent.change(screen.getByRole("textbox", { name: en.Budgets.amountFor.replace("{name}", "Two") }), { target: { value: "1" } });
  expect(first.value).toBe("1000000000000000");
  expect(screen.getByRole("alert").textContent).toBe(en.Budgets.totalTooLarge);
  expect((screen.getByRole("button", { name: en.Budgets.save }) as HTMLButtonElement).disabled).toBe(true);
});
it("offers clear-only controls for carried archived limits and hides unused archives/children", async () => {
  const active: Category = { id: "active", kind: "expense", nameEn: "Active", nameAr: null, tile: 1, color: "teal", position: 1, parentId: null, archivedAt: null };
  mock.categories = [active, { ...active, id: "past", nameEn: "Past", archivedAt: "2026-11-04" }, { ...active, id: "unused", nameEn: "Unused", archivedAt: "2026-11-04" }, { ...active, id: "child", nameEn: "Child", parentId: "active" }];
  mock.saveBudgets.mockResolvedValue({ ok: false, error: "notConfigured" });
  render(<NextIntlClientProvider locale="en" messages={en}><BudgetsSheet state={{ data: { month: "2026-11", currency: "USD", rows: [{ categoryId: "past", limitMinor: 5000, spentMinor: 0, leftMinor: 5000, progress: 0 }], totalLimitMinor: 5000, totalSpentMinor: 0 }, salaryAfterMinor: null }} onClose={() => {}} /></NextIntlClientProvider>);
  expect(screen.queryByRole("textbox", { name: "Budget for Past" })).toBeNull();
  expect(screen.queryByText("Unused")).toBeNull();
  expect(screen.queryByText("Child")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear budget for Past" }));
  fireEvent.click(screen.getByRole("button", { name: "Save budgets" }));
  await waitFor(() => expect(mock.saveBudgets).toHaveBeenCalledWith({ month: "2026-11", currency: "USD", limits: [{ categoryId: "past", limitMinor: null }] }));
});
