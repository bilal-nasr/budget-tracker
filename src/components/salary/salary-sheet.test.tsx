// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { AppDataProvider } from "@/components/providers/app-data";
import type { Wallet } from "@/features/wallets/schema";
vi.mock("@/features/salary/actions", () => ({ saveSalary: vi.fn(), clearSalary: vi.fn() }));
vi.mock("@/components/ui/sheet-shell", () => ({ SheetShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
import { SalarySheet } from "./salary-sheet";

afterEach(cleanup);
it("requires fresh entry instead of reinterpreting a salary from an unavailable SYP wallet", () => {
  const active: Wallet = { id: "usd", name: "USD", currency: "USD", kind: "cash", position: 0, openingBalanceMinor: 0, balanceMinor: 0, archived: false };
  const archived: Wallet = { ...active, id: "syp", name: "SYP", currency: "SYP", archived: true };
  render(<NextIntlClientProvider locale="en" messages={en}><AppDataProvider wallets={[active, archived]} categories={[]} timezone="Asia/Beirut" salary={{ walletId: "syp", amountMinor: 1250 }} usdLbpRate={null}>
    <SalarySheet open onClose={vi.fn()} />
  </AppDataProvider></NextIntlClientProvider>);
  expect((screen.getByLabelText(en.Salary.amount) as HTMLInputElement).value).toBe("");
  expect((screen.getByRole("button", { name: en.Salary.save }) as HTMLButtonElement).disabled).toBe(true);
});
